import { normalizeThreadName } from "../addressing"
import type { AliasError, AliasHolder, AliasRegistry, AliasResult } from "./ports"

/** The signed-in device's way into the account service: its origin and a bearer token that refreshes. */
export type ServiceAccess = {
  readonly origin: string
  readonly accessToken: () => Promise<string>
  readonly fetch?: (request: Request) => Promise<Response>
}

// The account service's session-alias routes (contract 1.31.0): every alias travels in a POST body under `plain-v1`,
// where the stored key and value are both the normalized alias and the session is its id.
const CONTRACT_VERSION = "1.31.0"
const SCHEME = "plain-v1"
const LOOKUP_MAX = 500
// The service-auth protocol's bound on one account-service request: a stalled connection never holds a tool call.
const REQUEST_TIMEOUT_MS = 30_000
const ROUTES = { claim: "/v1/session-aliases", rename: "/v1/session-aliases/rename", release: "/v1/session-aliases/release", resolve: "/v1/session-aliases/resolve", of: "/v1/session-aliases/of" } as const

// The service's alias rules, checked before anything is sent: an alias it would refuse never leaves this device.
const SESSION_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u
function brokenRule(normalized: string): string | undefined {
  if (normalized.length === 0) return "empty"
  if ([...normalized].length > 64) return "too_long"
  if (CONTROL_OR_FORMAT.test(normalized)) return "control_character"
  if (SESSION_ID_SHAPE.test(normalized)) return "session_id_shape"
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
const failed = <T>(code: AliasError["code"], message: string, details?: AliasError["details"]): AliasResult<T> => ({ kind: "error", error: { code, message, ...(details === undefined ? {} : { details }) } })
const unavailable = <T>(reason: string): AliasResult<T> => failed("alias_registry_unavailable", `The account's alias registry could not be used (${reason}).`, { reason })
const notFound = <T>(): AliasResult<T> => failed("alias_not_found", "No thread of this account holds that alias.")

function holderOf(value: unknown): AliasHolder | undefined {
  if (!isRecord(value)) return undefined
  const session = text(value["session_value"])
  const device = text(value["device"])
  return session === undefined || device === undefined ? undefined : { session_id: session, device }
}

function refusal<T>(body: unknown, status: number): AliasResult<T> {
  const error = isRecord(body) && isRecord(body["error"]) ? body["error"] : undefined
  const code = text(error?.["code"])
  const message = text(error?.["message"]) ?? `The account service refused the alias (${status}).`
  const detail = isRecord(error?.["detail"]) ? error["detail"] : undefined
  if (code === "alias_taken") {
    const holder = holderOf(detail?.["holder"])
    return failed("alias_taken", message, holder === undefined ? undefined : { holder })
  }
  if (code === "alias_invalid") {
    const rule = text(detail?.["rule"])
    return failed("alias_invalid", message, rule === undefined ? undefined : { reason: rule })
  }
  if (code === "alias_not_found") return failed("alias_not_found", message)
  return unavailable(code ?? `http_${status}`)
}

/** The frozen `AliasRegistry` port v1 over the account service's session-alias routes, as the signed-in device. */
export function createServiceAliasRegistry(access: ServiceAccess): AliasRegistry {
  const send = async (route: keyof typeof ROUTES, body: Record<string, unknown>): Promise<AliasResult<unknown>> => {
    let token: string
    try {
      token = await access.accessToken()
    } catch {
      return unavailable("sign_in")
    }
    let response: Response
    try {
      response = await (access.fetch ?? fetch)(new Request(new URL(ROUTES[route], access.origin).href, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "omo-contract-version": CONTRACT_VERSION },
        body: JSON.stringify({ scheme: SCHEME, ...body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }))
    } catch (error) {
      return unavailable(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network")
    }
    const raw = await response.text().catch(() => "")
    let json: unknown
    try {
      json = raw === "" ? null : JSON.parse(raw)
    } catch {
      return unavailable("unreadable_response")
    }
    return response.ok ? { kind: "ok", value: json } : refusal(json, response.status)
  }
  const holding = (result: AliasResult<unknown>): AliasResult<{ readonly alias: string; readonly holder: AliasHolder }> => {
    if (result.kind === "error") return result
    const holder = holderOf(result.value)
    const alias = isRecord(result.value) ? text(result.value["alias_value"]) : undefined
    return holder === undefined || alias === undefined ? unavailable("unreadable_response") : { kind: "ok", value: { alias, holder } }
  }
  return {
    claim: async ({ alias, holder, idempotency_key }) => {
      const key = normalizeThreadName(alias)
      const rule = brokenRule(key)
      if (rule !== undefined) return failed("alias_invalid", "That alias breaks an alias rule.", { reason: rule })
      return holding(await send("claim", { alias_key: key, alias_value: key, session_key: holder.session_id, session_value: holder.session_id, device: holder.device, idempotency_key }))
    },
    rename: async ({ session_id, from, to, idempotency_key }) => {
      const toKey = normalizeThreadName(to)
      const rule = brokenRule(toKey)
      if (rule !== undefined) return failed("alias_invalid", "That alias breaks an alias rule.", { reason: rule })
      const fromKey = normalizeThreadName(from)
      if (brokenRule(fromKey) !== undefined) return notFound()
      return holding(await send("rename", { session_key: session_id, from_key: fromKey, to_key: toKey, to_value: toKey, idempotency_key }))
    },
    release: async ({ session_id, alias }) => {
      const key = normalizeThreadName(alias)
      if (brokenRule(key) !== undefined) return { kind: "ok", value: { released: false } }
      const result = await send("release", { session_key: session_id, alias_key: key })
      if (result.kind === "error") return result
      return isRecord(result.value) && typeof result.value["released"] === "boolean" ? { kind: "ok", value: { released: result.value["released"] } } : unavailable("unreadable_response")
    },
    resolve: async (alias) => {
      const key = normalizeThreadName(alias)
      if (brokenRule(key) !== undefined) return notFound()
      const result = await send("resolve", { alias_key: key })
      if (result.kind === "error") return result
      const holder = holderOf(result.value)
      return holder === undefined ? unavailable("unreadable_response") : { kind: "ok", value: holder }
    },
    aliasesOf: async (sessionIds) => {
      const aliases = new Map<string, string>()
      for (let start = 0; start < sessionIds.length; start += LOOKUP_MAX) {
        const result = await send("of", { session_keys: sessionIds.slice(start, start + LOOKUP_MAX) })
        if (result.kind === "error") return result
        const rows = isRecord(result.value) ? result.value["aliases"] : undefined
        if (!Array.isArray(rows)) return unavailable("unreadable_response")
        for (const row of rows) {
          const session = isRecord(row) ? text(row["session_key"]) : undefined
          const alias = isRecord(row) ? text(row["alias_value"]) : undefined
          if (session !== undefined && alias !== undefined) aliases.set(session, alias)
        }
      }
      return { kind: "ok", value: aliases }
    },
  }
}
