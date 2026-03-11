import { DEFAULT_STALL_PATTERNS } from "./constants"

function getTrailingSegment(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ")
  if (!normalized) return ""

  const sentenceParts = normalized.split(/(?<=[.!?])\s+/)
  return sentenceParts[sentenceParts.length - 1]?.trim().toLowerCase() ?? ""
}

export function detectStallPattern(
  text: string,
  patterns: readonly string[] = DEFAULT_STALL_PATTERNS,
): boolean {
  if (!text.trim()) return false

  const tail = text.slice(-800)
  const lines = tail.split("\n").map((line) => line.trim()).filter(Boolean)
  const hotZone = lines.slice(-3).join(" ")
  const trailingSegment = getTrailingSegment(hotZone)

  return patterns.some((pattern) => trailingSegment.startsWith(pattern.toLowerCase()))
}
