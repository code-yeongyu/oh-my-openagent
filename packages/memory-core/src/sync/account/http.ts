// The signed-in account's chain routes (omo-service contract 1.17.0): the bootstrap reads a device
// verifies its keyring from (`GET /v1/sync/entries?after=n`, `GET /v1/sync/keys`,
// `GET /v1/sync/recovery-wraps`), the keyring appends (`PUT /v1/sync/keys`,
// `POST /v1/sync/recovery/join`) and the state read. Every response is untrusted input: callers
// verify what they read through the client chain before using it.

import type { KeyringEntry } from "../crypto/entry.ts"
import type { AppendResult, ChainRow, KeyringAppendRequest, RecoveryTransport, RecoveryWrapRow, TransportRefusal } from "../recovery/ports.ts"

export interface AccountHttpOptions {
  readonly baseUrl: string
  /** The device's bearer token, read per request so a refresh takes effect. */
  readonly token: () => string | Promise<string>
  readonly fetch?: typeof fetch
}

export interface AccountState {
  readonly head: { readonly seq: number; readonly link: string; readonly keyring_link: string }
  readonly currentEpoch: number
  readonly rotationPending: boolean
}

export interface AccountHttp extends RecoveryTransport {
  listEntriesAfter(after: number): Promise<ReadonlyArray<ChainRow> | null>
  state(): Promise<AccountState | null>
}

export class AccountHttpError extends Error {
  override readonly name = "AccountHttpError"
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`account sync request refused: ${code} (${status})`)
  }
}

const REFUSALS: ReadonlySet<string> = new Set<TransportRefusal>(["stale_base", "rate_limited", "not_found"])

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const listOf = (value: unknown, key: string): ReadonlyArray<unknown> | null => {
  if (!isRecord(value)) return null
  const list = value[key]
  return Array.isArray(list) ? list : null
}

export function createAccountHttp(options: AccountHttpOptions): AccountHttp {
  const doFetch = options.fetch ?? fetch
  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const headers: Record<string, string> = { authorization: `Bearer ${await options.token()}` }
    if (body !== undefined) headers["content-type"] = "application/json"
    return doFetch(`${options.baseUrl}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  }
  const codeOf = async (response: Response): Promise<string> =>
    response.json().then(
      (b: unknown) => {
        const error = isRecord(b) ? b["error"] : undefined
        return isRecord(error) && typeof error["code"] === "string" ? error["code"] : "unknown"
      },
      () => "unknown",
    )
  const read = async (path: string): Promise<unknown> => {
    const response = await send("GET", path)
    if (!response.ok) throw new AccountHttpError(response.status >= 500 ? "unavailable" : await codeOf(response), response.status)
    return response.json()
  }
  const append = async (path: string, method: "PUT" | "POST", request: KeyringAppendRequest): Promise<AppendResult> => {
    const response = await send(method, path, request)
    if (response.ok) {
      const body: unknown = await response.json()
      const seq = isRecord(body) ? body["seq"] : undefined
      if (typeof seq !== "number" || !Number.isSafeInteger(seq)) throw new AccountHttpError("malformed_reply", response.status)
      return { ok: true, seq }
    }
    if (response.status >= 500) throw new AccountHttpError("unavailable", response.status)
    const code = await codeOf(response)
    return { ok: false, reason: REFUSALS.has(code) ? (code as TransportRefusal) : "refused" }
  }
  const entriesAfter = async (after: number): Promise<ReadonlyArray<ChainRow> | null> =>
    listOf(await read(`/v1/sync/entries?after=${after}`), "entries") as ReadonlyArray<ChainRow> | null
  return {
    listEntriesAfter: entriesAfter,
    listEntries: () => entriesAfter(0),
    listKeys: async () => listOf(await read("/v1/sync/keys"), "entries") as ReadonlyArray<KeyringEntry> | null,
    listRecoveryWraps: async () => listOf(await read("/v1/sync/recovery-wraps"), "wraps") as ReadonlyArray<RecoveryWrapRow> | null,
    appendKeys: (request) => append("/v1/sync/keys", "PUT", request),
    recoveryJoin: (request) => append("/v1/sync/recovery/join", "POST", request),
    async state() {
      const body = await read("/v1/sync/state")
      if (!isRecord(body) || !isRecord(body["head"])) return null
      const head = body["head"]
      const seq = head["seq"]
      const link = head["link"]
      const keyringLink = head["keyring_link"]
      const epoch = body["current_epoch"]
      if (typeof seq !== "number" || typeof link !== "string" || typeof keyringLink !== "string" || typeof epoch !== "number") return null
      return { head: { seq, link, keyring_link: keyringLink }, currentEpoch: epoch, rotationPending: body["rotation_pending"] === true }
    },
  }
}
