import { USAGE_TIMEOUT_MS } from "../constants"

/**
 * A failed usage request, carrying the two things the backoff needs: what the endpoint said,
 * and how long it asked to be left alone.
 */
export class UsageHttpError extends Error {
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined

  constructor(message: string, options: { readonly status?: number; readonly retryAfterMs?: number } = {}) {
    super(message)
    this.name = "UsageHttpError"
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
  }
}

/** The one seam through which this component touches the network; tests pass their own. */
export type UsageFetch = (url: string, headers: Readonly<Record<string, string>>) => Promise<unknown>

/**
 * `redirect: "error"` on purpose: a usage endpoint that starts redirecting is a login wall or a
 * captive portal, and following it would post a bearer token somewhere it was never meant to go.
 */
export function createUsageFetch(): UsageFetch {
  return async (url, headers) => {
    const response = await fetch(url, {
      headers: { ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(USAGE_TIMEOUT_MS),
    })
    if (!response.ok) {
      const retryAfter = Number(response.headers.get("retry-after"))
      throw new UsageHttpError(`HTTP ${response.status}`, {
        status: response.status,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1_000 } : {}),
      })
    }
    return await response.json()
  }
}

/** Panel-sized explanation of why an endpoint said no; it has one narrow line to say it in. */
export function describeUsageError(error: unknown): string {
  const status = error instanceof UsageHttpError ? error.status : undefined
  if (status === 401 || status === 403) return "auth stale - run /login"
  if (status === 429) return "rate limited"
  if (status !== undefined) return `HTTP ${status}`
  const message = error instanceof Error ? error.message : String(error)
  if (/abort|timeout|timed out/i.test(message)) return "timed out"
  return message.length > 28 ? `${message.slice(0, 27)}\u2026` : message
}
