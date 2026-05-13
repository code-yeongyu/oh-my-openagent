export interface AutoRetrySignal {
  signal: string
}

const AUTO_RETRY_PATTERNS: Array<(combined: string) => boolean> = [
  (combined) => /retrying\s+in/i.test(combined),
  (combined) =>
    /(?:too\s+many\s+requests|quota\s+will\s+reset\s+after|quota\s*exceeded|usage\s+limit|rate\s+limit|limit\s+reached|all\s+credentials\s+for\s+model|cool(?:ing)?\s*down|exhausted\s+your\s+capacity)/i.test(combined),
]

export function extractAutoRetrySignal(info: Record<string, unknown> | undefined): AutoRetrySignal | undefined {
  if (!info) return undefined

  const candidates: string[] = []

  const directStatus = info.status
  if (typeof directStatus === "string") candidates.push(directStatus)

  const summary = info.summary
  if (typeof summary === "string") candidates.push(summary)

  const message = info.message
  if (typeof message === "string") candidates.push(message)

  const details = info.details
  if (typeof details === "string") candidates.push(details)

  const combined = candidates.join("\n")
  if (!combined) return undefined

  return AUTO_RETRY_PATTERNS.some((test) => test(combined)) ? { signal: combined } : undefined
}
