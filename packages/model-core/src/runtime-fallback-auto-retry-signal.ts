export interface RuntimeFallbackAutoRetrySignal {
  signal: string
}

const AUTO_RETRY_PATTERNS: Array<(combined: string) => boolean> = [
  (combined) => /retrying\s+in/i.test(combined),
  (combined) =>
    /(?:too\s+many\s+requests|quota\s+will\s+reset\s+after|quota\s*exceeded|exceeded.*quota|usage\s+limit|usage\s*quota|rate\s+limit|limit\s+reached|all\s+credentials\s+for\s+model|cool(?:ing)?\s*down|exhausted\s+your\s+capacity)/i.test(combined),
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
