import { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "./runtime-fallback-retryable-patterns"

export interface RuntimeFallbackAutoRetrySignal {
  signal: string
}

const AUTO_RETRY_PATTERNS: Array<(combined: string) => boolean> = [
  (combined) => /retrying\s+in/i.test(combined),
  (combined) => /usage\s+limit|limit\s+reached/i.test(combined),
  (combined) => RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(combined)),
]

function appendStringCandidate(candidates: string[], value: unknown): void {
  if (typeof value === "string") candidates.push(value)
}

export function extractRuntimeFallbackAutoRetrySignal(
  info: Record<string, unknown> | undefined,
): RuntimeFallbackAutoRetrySignal | undefined {
  if (!info) return undefined

  const candidates: string[] = []

  appendStringCandidate(candidates, info.status)
  appendStringCandidate(candidates, info.summary)
  appendStringCandidate(candidates, info.message)
  appendStringCandidate(candidates, info.details)

  const combined = candidates.join("\n")
  if (!combined) return undefined

  return AUTO_RETRY_PATTERNS.some((test) => test(combined)) ? { signal: combined } : undefined
}
