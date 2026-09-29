// Slack Web API client for the gateway adapter: form-encoded POSTs, the token only in the
// Authorization header (plus the `d` session cookie for a user session token), `ok: true` as the
// only success, and HTTP 429 / `ratelimited` waited out with Retry-After before the same call is
// retried. Slack answers 429 before performing the call, so a retry never posts twice; a network
// error after the request left may have been performed, so it is surfaced, never retried blindly.
import { AdapterFatal } from "../../adapter/contract"
import type { SlackClock } from "./clock"
import { isJson, type Json } from "./wire"

/** Errors that mean the credential itself is dead: the connector stops, retrying cannot help. */
export const FATAL_AUTH_ERRORS: ReadonlySet<string> = new Set(["invalid_auth", "token_revoked", "token_expired", "account_inactive", "not_authed", "team_mismatch"])

export class SlackApiError extends Error {
  readonly method: string
  readonly error: string

  constructor(method: string, error: string) {
    super(`slack ${method}: ${error}`)
    this.name = "SlackApiError"
    this.method = method
    this.error = error
  }
}

/** The credential was rejected: an AdapterFatal, so the connector host stops instead of restarting. */
export class SlackAuthError extends AdapterFatal {
  readonly method: string
  readonly error: string

  constructor(method: string, error: string) {
    super("slack", error, `slack ${method}: ${error}`)
    this.name = "SlackAuthError"
    this.method = method
    this.error = error
  }
}

/**
 * One per adapter: after the first rejected credential every API call and every reconnect refuses
 * at once with that same SlackAuthError, without touching Slack (no retry loop). The connector host
 * writes the one owner notice.
 */
export class AuthLatch {
  private tripped: SlackAuthError | null = null

  get error(): SlackAuthError | null {
    return this.tripped
  }

  trip(error: SlackAuthError): SlackAuthError {
    this.tripped ??= error
    return this.tripped
  }
}

export type SlackApiOptions = {
  token: string
  latch: AuthLatch
  /** the `d` cookie of a user session token (xoxc); absent for bot and app tokens */
  cookie?: string
  apiBase: string
  fetch: typeof fetch
  clock: SlackClock
  /** how many 429 answers one call waits out before giving up; default 5 */
  maxRateLimitRetries?: number
}

export type Params = Readonly<Record<string, string | number | boolean | undefined>>

function form(params: Params): URLSearchParams {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) body.set(key, String(value))
  return body
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after") ?? "1")
  return Math.max(0, Math.ceil((Number.isFinite(seconds) && seconds > 0 ? seconds : 1) * 1000))
}

export class SlackApi {
  private readonly maxRetries: number

  constructor(private readonly options: SlackApiOptions) {
    if (options.token.trim() === "") throw new Error("slack adapter: an empty token")
    this.maxRetries = options.maxRateLimitRetries ?? 5
  }

  get clock(): SlackClock {
    return this.options.clock
  }

  redact(text: string): string {
    let out = text.split(this.options.token).join("<redacted>")
    if (this.options.cookie !== undefined && this.options.cookie !== "") out = out.split(this.options.cookie).join("<redacted>")
    return out
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.options.token}`, ...extra }
    if (this.options.cookie !== undefined) headers.Cookie = `d=${this.options.cookie}`
    return headers
  }

  /** Call `method`; resolves to the whole response object once Slack said `ok: true`. */
  async call(method: string, params: Params = {}, signal?: AbortSignal): Promise<Json> {
    const dead = this.options.latch.error
    if (dead !== null) throw dead
    for (let attempt = 0; ; attempt += 1) {
      let response: Response
      try {
        response = await this.options.fetch(`${this.options.apiBase}/${method}`, {
          method: "POST",
          headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
          body: form(params),
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        if (signal?.aborted === true) throw error
        throw new Error(this.redact(`slack ${method}: ${error instanceof Error ? error.message : String(error)}`))
      }
      const limited = response.status === 429
      let parsed: unknown = null
      try {
        parsed = await response.json()
      } catch {
        if (!limited) throw new SlackApiError(method, `non-JSON response (HTTP ${response.status})`)
      }
      const error = isJson(parsed) && typeof parsed.error === "string" ? parsed.error : null
      if ((limited || error === "ratelimited") && attempt < this.maxRetries) {
        await this.options.clock.sleep(retryAfterMs(response), signal)
        continue
      }
      if (isJson(parsed) && parsed.ok === true) return parsed
      const code = error ?? (limited ? "ratelimited" : `HTTP ${response.status}`)
      if (FATAL_AUTH_ERRORS.has(code)) throw this.options.latch.trip(new SlackAuthError(method, code))
      throw new SlackApiError(method, code)
    }
  }

  /** Download a private file (`url_private`) into memory with the adapter's credential. */
  async download(url: string): Promise<Uint8Array> {
    let response: Response
    try {
      response = await this.options.fetch(url, { headers: this.headers() })
    } catch (error) {
      throw new Error(this.redact(`slack file download: ${error instanceof Error ? error.message : String(error)}`))
    }
    if (!response.ok) throw new Error(`slack file download returned ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  /** POST raw bytes to a pre-signed `files.getUploadURLExternal` url (no credential attached). */
  async uploadBytes(url: string, bytes: Uint8Array): Promise<void> {
    const response = await this.options.fetch(url, { method: "POST", body: bytes })
    if (!response.ok) throw new Error(`slack upload_url answered ${response.status}`)
  }
}
