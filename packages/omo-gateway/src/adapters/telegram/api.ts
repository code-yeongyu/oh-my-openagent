// Telegram Bot API client for the gateway adapter: one POST per method, typed errors, the token
// kept out of every message, and 429 `retry_after` honored before the same call is retried.
//
// Only 429 is retried. Telegram answers 429 before it performs the call, so retrying it can never
// post twice; a network error after the request left the machine might have been performed, so it
// is surfaced to the caller instead of being retried blindly.

import { AdapterFatal } from "../../adapter/contract"

/** Time source and sleep, injectable so rate limits and retry_after are testable without waiting. */
export type Clock = {
  now(): number
  /** resolves after `ms`; rejects with the signal's reason when `signal` aborts first */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, Math.max(0, ms))
      const onAbort = () => {
        clearTimeout(timer)
        reject(signal?.reason)
      }
      signal?.addEventListener("abort", onAbort, { once: true })
    }),
}

/** A Bot API call that Telegram answered with `ok: false`. */
export class TelegramApiError extends Error {
  readonly method: string
  readonly error_code: number
  readonly description: string

  constructor(method: string, error_code: number, description: string) {
    super(`telegram ${method} failed (${error_code}): ${description}`)
    this.name = "TelegramApiError"
    this.method = method
    this.error_code = error_code
    this.description = description
  }
}

/** A Bot API answer that refuses the bot itself (401 or 409): the adapter stops and the connector does not restart it. */
abstract class TelegramFatalError extends AdapterFatal {
  readonly method: string
  readonly error_code: number
  readonly description: string

  constructor(method: string, error_code: number, description: string) {
    super("telegram", String(error_code), `telegram ${method} failed (${error_code}): ${description}`)
    this.method = method
    this.error_code = error_code
    this.description = description
  }
}

/** 409 on getUpdates: another poller (or a webhook) owns this bot. The adapter stops; it never fights for the bot. */
export class TelegramConflictError extends TelegramFatalError {
  constructor(method: string, description: string) {
    super(method, 409, description)
    this.name = "TelegramConflictError"
  }
}

/** 401: the token is wrong or revoked. The adapter stops; retrying cannot help. */
export class TelegramAuthError extends TelegramFatalError {
  constructor(method: string, description: string) {
    super(method, 401, description)
    this.name = "TelegramAuthError"
  }
}

export type TelegramApiOptions = {
  token: string
  /** default https://api.telegram.org */
  apiBase?: string
  fetch?: typeof fetch
  clock?: Clock
  /** how many 429 answers one call waits out before giving up; default 5 */
  maxRateLimitRetries?: number
}

type Envelope = { ok?: unknown; result?: unknown; error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } }

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export class TelegramApi {
  private readonly token: string
  private readonly apiBase: string
  private readonly fetchImpl: typeof fetch
  readonly clock: Clock
  private readonly maxRetries: number

  constructor(options: TelegramApiOptions) {
    this.token = options.token
    this.apiBase = (options.apiBase ?? "https://api.telegram.org").replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? fetch
    this.clock = options.clock ?? realClock
    this.maxRetries = options.maxRateLimitRetries ?? 5
  }

  redact(text: string): string {
    return this.token === "" ? text : text.split(this.token).join("<redacted>")
  }

  /**
   * Call `method` with a JSON body, or a FormData body for uploads (rebuilt per attempt by passing a
   * function). Resolves to `result`; throws TelegramApiError (or its 409/401 subclasses) otherwise.
   */
  async call<T>(method: string, body: Record<string, unknown> | (() => FormData) = {}, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const init: RequestInit =
        typeof body === "function"
          ? { method: "POST", body: body(), signal }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }
      let response: Response
      try {
        response = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, init)
      } catch (error) {
        if (signal?.aborted) throw error
        throw new Error(this.redact(`telegram ${method}: ${error instanceof Error ? error.message : String(error)}`))
      }
      let parsed: unknown
      try {
        parsed = await response.json()
      } catch {
        throw new TelegramApiError(method, response.status, `non-JSON response (HTTP ${response.status})`)
      }
      if (!isEnvelope(parsed)) throw new TelegramApiError(method, response.status, "response is not an object")
      if (parsed.ok === true) return parsed.result as T
      const code = typeof parsed.error_code === "number" ? parsed.error_code : response.status
      const description = this.redact(typeof parsed.description === "string" ? parsed.description : "no description")
      const retryAfter = parsed.parameters?.retry_after
      if (code === 429 && attempt < this.maxRetries) {
        const seconds = typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : 1
        await this.clock.sleep(seconds * 1000, signal)
        continue
      }
      if (code === 409) throw new TelegramConflictError(method, description)
      if (code === 401) throw new TelegramAuthError(method, description)
      throw new TelegramApiError(method, code, description)
    }
  }

  /** Download a file by its `file_path` (from getFile) into memory. The URL carries the token, so it never leaves this method. */
  async download(filePath: string, signal?: AbortSignal): Promise<Uint8Array> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBase}/file/bot${this.token}/${filePath}`, { signal })
    } catch (error) {
      throw new Error(this.redact(`telegram file download: ${error instanceof Error ? error.message : String(error)}`))
    }
    if (!response.ok) throw new Error(`telegram file download returned ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}
