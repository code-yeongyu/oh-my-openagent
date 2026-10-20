import { normalizeRendererText } from "../renderer-text"

/** The last route a child left, and the provider's explanation for leaving it. */
export type ModelFallbackRecord = {
  readonly from: string
  readonly reason: string
  readonly limit?: "model" | "account"
  readonly resets_at?: string
}

export function formatModelFallback(fallback: ModelFallbackRecord | undefined): string | undefined {
  if (fallback === undefined) return undefined
  const reason = fallback.limit === undefined
    ? fallback.reason
    : `limit${fallback.resets_at === undefined ? "" : `, resets ${fallback.resets_at}`}`
  return normalizeRendererText(`fell back from ${fallback.from}: ${reason}`)
}
