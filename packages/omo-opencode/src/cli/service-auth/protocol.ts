import { z } from "zod"
import { signInHint } from "./accounts-gate"
import { credentialOwnerSchema } from "./credential-owner"
import { terminalText } from "./terminal-text"

export class SignInError extends Error {
  override readonly name = "SignInError"
  constructor(message: string, readonly retryable = false) { super(message) }
}

export class RequestFailure extends SignInError {
  constructor(readonly notSent: boolean, readonly responseStatus?: number) {
    super("Unable to complete the service request. Check the connection and retry.", true)
  }
}

class InvalidApiResponse extends SignInError {
  constructor(readonly status: number) { super("The service returned an invalid error response.") }
}

export const platformSchema = z.enum(["macos", "linux", "windows"])
export type Platform = z.infer<typeof platformSchema>
const nonempty = z.string().min(1)
const timestamp = z.string().datetime({ offset: true })
export const tokenSchema = z.object({
  accessToken: nonempty, accessTokenExpiresAt: timestamp, refreshToken: nonempty,
})
export const grantSchema = tokenSchema.extend({
  device: z.object({ id: nonempty, name: nonempty }),
  offlineGrant: nonempty.optional(),
  owner: credentialOwnerSchema.optional(),
  writerFloor: z.union([z.literal(1), z.literal(2)]).optional(),
  freshAuthorizationProof: nonempty.optional(),
})
export const credentialSchema = grantSchema.extend({
  signingPrivateKey: nonempty, sealingPrivateKey: nonempty,
  refreshState: z.literal("uncertain").optional(),
  credentialGeneration: nonempty.optional(),
  accountId: nonempty.optional(),
  // Preserve even a malformed journal so the owning transaction fails closed without re-keying.
  refreshAttempt: z.unknown().optional(),
})
export type Credentials = z.infer<typeof credentialSchema>
export const deviceCodeSchema = z.object({
  deviceCode: z.string().regex(/^dc\.[A-Za-z0-9_-]{43}$/),
  userCode: z.string().regex(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/),
  matchingCode: z.string().regex(/^\d{3} \d{3}$/),
  verificationUri: z.string().transform(terminalText).pipe(z.string().url()),
  expiresAt: timestamp,
  intervalSeconds: z.number().int().min(1).max(60),
})
const envelopeSchema = z.object({
  error: z.object({
    code: nonempty, message: z.string(), retryable: z.boolean(), requestId: z.string(),
    detail: z.unknown().optional(),
  }),
})
const limitSchema = z.object({
  reason: z.literal("device_limit"), managementToken: nonempty,
  used: z.number().int().nonnegative(), limit: z.number().int().nonnegative(),
})
export const deviceListSchema = z.object({
  devices: z.array(z.object({ id: nonempty, name: nonempty, revokedAt: timestamp.nullable() })),
})
export type ListedDevice = z.infer<typeof deviceListSchema>["devices"][number]
const currentDeviceListSchema = z.object({
  devices: z.array(z.object({ id: nonempty, current: z.boolean(), revokedAt: timestamp.nullable() })),
})
/** The one unrevoked device the calling token authenticates, or null when the list does not name exactly one. */
export function currentServiceDevice(body: unknown): string | null {
  const parsed = currentDeviceListSchema.safeParse(body)
  if (!parsed.success) return null
  const current = parsed.data.devices.filter(device => device.current)
  const only = current.length === 1 ? current[0] : undefined
  return only !== undefined && only.revokedAt === null ? only.id : null
}
export type ChooseDevice = (devices: readonly ListedDevice[]) => Promise<string | null>

const REFUSAL_CODES = [
  "unauthorized", "account_deleted", "reauth_required", "invalid_grant", "device_revoked", "entitlement_required",
  "authorization_pending", "slow_down", "access_denied", "expired_token", "rate_limited",
  "internal", "unavailable", "forbidden", "invalid_request", "not_found",
  "client_upgrade_required", "writer_floor_mismatch", "service_upgrade_required", "refresh_recovery_expired",
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number] | "unknown"
const isKnownRefusal = (code: string): code is (typeof REFUSAL_CODES)[number] => (REFUSAL_CODES as readonly string[]).includes(code)

/** What a refused request asks of the person; the message keys on this, never on the server's text. */
export type RefusalGuidance = "sign_in_again" | "wait" | "service_trouble" | "update_omo" | "account_deleted" | "account_refused"

export function refusalGuidance(code: RefusalCode, status: number): RefusalGuidance {
  switch (code) {
    case "unauthorized": case "reauth_required": case "invalid_grant": case "device_revoked": case "expired_token":
      return "sign_in_again"
    case "rate_limited": case "slow_down":
      return "wait"
    case "internal": case "unavailable":
      return "service_trouble"
    case "invalid_request": case "not_found":
      return "update_omo"
    case "account_deleted":
      return "account_deleted"
    case "entitlement_required": case "forbidden": case "access_denied": case "authorization_pending":
      return "account_refused"
    case "client_upgrade_required": case "writer_floor_mismatch": case "service_upgrade_required": case "refresh_recovery_expired":
    case "unknown":
      if (status === 401) return "sign_in_again"
      if (status === 429) return "wait"
      if (status >= 500) return "service_trouble"
      return "account_refused"
  }
}

export function refusalMessage(guidance: RefusalGuidance): string {
  switch (guidance) {
    case "sign_in_again": return `Your OmO sign-in ended. ${signInHint("again")}`
    case "wait": return "OmO accounts got too many requests from this computer. Wait a minute, then try again."
    case "service_trouble": return "OmO accounts are having trouble right now. Try again in a few minutes."
    case "update_omo": return "This version of omo can't complete that request. Update omo with omo update, then try again."
    case "account_deleted": return "This OmO account was deleted. Sign in with another account to keep using OmO."
    case "account_refused": return "OmO accounts refused this request for your account. Check your account and its devices, then try again."
  }
}

export class ApiRefusal extends SignInError {
  readonly code: RefusalCode
  readonly #detail: z.infer<typeof limitSchema> | undefined
  readonly #retryAfter: string | null
  constructor(code: string, readonly status: number, detail?: z.infer<typeof limitSchema>, retryAfter: string | null = null) {
    const known: RefusalCode = isKnownRefusal(code) ? code : "unknown"
    // Server messages and unknown codes can contain credentials; never echo either.
    super(refusalMessage(refusalGuidance(known, status)), status === 429 || status >= 500)
    this.code = known
    this.#detail = detail
    this.#retryAfter = retryAfter
  }
  get detail() { return this.#detail }
  retryDelay(now: number, fallback: number): number {
    const raw = this.#retryAfter
    const delay = raw === null ? Number.NaN : /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now
    return Math.min(60_000, Math.max(fallback, Number.isFinite(delay) ? delay : fallback))
  }
}

export function parseReply<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new SignInError("The service returned an invalid response.")
  return result.data
}

export function serviceOrigin(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new SignInError("Invalid service URL.") }
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port !== ""
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new SignInError("Service URLs must be HTTPS origins, or http://127.0.0.1:<port> for local testing.")
  }
  return url.origin
}

export async function requestApi(api: string, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  let body: unknown
  try {
    response = await fetch(`${api}${path}`, {
      ...init, redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
    const code: unknown = cause instanceof Error ? Reflect.get(cause, "code") : undefined
    // Certificate checks and explicitly connect/handshake-phase failures precede HTTP.
    // Generic resets and timeouts do not prove which phase failed.
    throw new RequestFailure(typeof code === "string" && [
      "ENOTFOUND", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ConnectionRefused",
      "EADDRNOTAVAIL", "ENETDOWN", "EHOSTDOWN", "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_HANDSHAKE_TIMEOUT",
      "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "CERT_NOT_YET_VALID",
      "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_SIGNATURE_FAILURE",
      "CERT_UNTRUSTED", "CERT_REJECTED",
    ].includes(code))
  }
  if (response.status === 204) return null
  try { body = await response.json() } catch { throw new RequestFailure(false, response.status) }
  if (response.ok) return body
  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) throw new InvalidApiResponse(response.status)
  const error = envelope.data.error
  const detail = limitSchema.safeParse(error.detail)
  throw new ApiRefusal(error.code, response.status,
    error.code === "entitlement_required" && detail.success ? detail.data : undefined, response.headers.get("retry-after"))
}

export const jsonRequest = (body: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
})
