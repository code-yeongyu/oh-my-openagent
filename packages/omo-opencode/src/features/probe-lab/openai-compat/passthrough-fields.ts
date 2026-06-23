const PASSTHROUGH_KEYS = [
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
  "stop",
  "seed",
] as const

export type PassThroughKey = (typeof PASSTHROUGH_KEYS)[number]

export function extractPassThroughFields(
  incomingBody: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!incomingBody || typeof incomingBody !== "object") return out
  const body = incomingBody as Record<string, unknown>
  for (const key of PASSTHROUGH_KEYS) {
    const value = body[key]
    if (value === null || value === undefined) continue
    out[key] = value
  }
  return out
}
