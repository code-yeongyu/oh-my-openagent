export const REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const

export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

export const REASONING_AUTO = "auto" as const

const REASONING_LEVEL_SET = new Set<string>(REASONING_LEVELS)
const REASONING_LEVEL_OR_AUTO_SET = new Set<string>([...REASONING_LEVELS, REASONING_AUTO])

export function isReasoningLevel(value: string): value is ReasoningLevel {
  return REASONING_LEVEL_SET.has(value)
}

export function normalizeReasoning(
  input: string,
): { level?: ReasoningLevel | typeof REASONING_AUTO; passthrough?: string } {
  const normalized = input.trim().toLowerCase()
  if (!normalized) return {}
  if (normalized === "none") return { level: "off" }
  if (normalized === REASONING_AUTO) return { level: REASONING_AUTO }
  if (isReasoningLevel(normalized)) return { level: normalized }
  return { passthrough: normalized }
}

export function splitReasoningSuffix(
  model: string,
  options?: { readonly allowMaxSuffix?: boolean },
): { base: string; level?: string } {
  if (typeof model !== "string") return { base: "" }
  const trimmed = model.trim()
  if (!trimmed) return { base: "" }
  const separatorIndex = trimmed.lastIndexOf(":")
  if (separatorIndex === -1) return { base: trimmed }
  const base = trimmed.slice(0, separatorIndex).trim()
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase()
  if (!base || !REASONING_LEVEL_OR_AUTO_SET.has(token)) return { base: trimmed }
  // ":max" doubles as a real model-id ending, so bare ids keep it attached unless the
  // caller knows the string is provider-prefixed.
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/"))) return { base: trimmed }
  return { base, level: token }
}
