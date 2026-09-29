import type { DiscordClock } from "./clock"
import { isJson, type Json } from "./wire"

export class DiscordApiError extends Error {
  readonly status: number
  constructor(method: string, path: string, status: number, detail: string) {
    super(`discord ${method} ${path} returned ${status}${detail === "" ? "" : `: ${detail}`}`)
    this.name = "DiscordApiError"
    this.status = status
  }
}

/**
 * Discord allows 5 message creates or edits per 5 s per channel. Each channel keeps the start times
 * of its last 5 writes; a sixth waits until the oldest leaves the window. Writes to one channel are
 * serialized so concurrent sends cannot both take the last slot.
 */
export class ChannelBucket {
  private readonly starts = new Map<string, number[]>()
  private readonly tails = new Map<string, Promise<void>>()

  constructor(
    private readonly clock: DiscordClock,
    readonly limit = 5,
    readonly windowMs = 5000,
  ) {}

  take(channel: string): Promise<void> {
    const turn = (this.tails.get(channel) ?? Promise.resolve()).then(() => this.wait(channel))
    this.tails.set(channel, turn.catch(() => undefined))
    return turn
  }

  private async wait(channel: string): Promise<void> {
    const window = (this.starts.get(channel) ?? []).filter((at) => this.clock.now() - at < this.windowMs)
    if (window.length >= this.limit) {
      const oldest = window[0] ?? this.clock.now()
      await this.clock.sleep(oldest + this.windowMs - this.clock.now())
      window.shift()
    }
    window.push(this.clock.now())
    this.starts.set(channel, window)
  }
}

export type RestOptions = {
  token: string
  apiBase: string
  fetch: typeof fetch
  clock: DiscordClock
  maxAttempts?: number
}

type Body = { json: Json } | { form: () => FormData } | null

function retryAfterMs(response: Response, body: unknown): number {
  const seconds = isJson(body) && typeof body.retry_after === "number" ? body.retry_after : Number(response.headers.get("retry-after") ?? "1")
  return Math.max(0, Math.ceil((Number.isFinite(seconds) ? seconds : 1) * 1000))
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === "") return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Bot-token REST client: every request carries `Authorization: Bot <token>`; 429s wait retry_after and retry. */
export class DiscordRest {
  private readonly maxAttempts: number

  constructor(private readonly options: RestOptions) {
    if (options.token.trim() === "") throw new Error("discord adapter: an empty bot token")
    this.maxAttempts = options.maxAttempts ?? 5
  }

  async request(method: string, path: string, body: Body = null): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      const headers: Record<string, string> = { Authorization: `Bot ${this.options.token}` }
      let payload: string | FormData | undefined
      if (body !== null && "json" in body) {
        headers["Content-Type"] = "application/json"
        payload = JSON.stringify(body.json)
      } else if (body !== null) payload = body.form()
      const response = await this.options.fetch(`${this.options.apiBase}${path}`, { method, headers, body: payload })
      const parsed = await readBody(response)
      if (response.status === 429 && attempt < this.maxAttempts) {
        await this.options.clock.sleep(retryAfterMs(response, parsed))
        continue
      }
      if (!response.ok) {
        const detail = isJson(parsed) && typeof parsed.message === "string" ? parsed.message : ""
        throw new DiscordApiError(method, path, response.status, detail)
      }
      return parsed
    }
  }
}
