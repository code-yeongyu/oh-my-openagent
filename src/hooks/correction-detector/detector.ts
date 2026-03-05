import { CORRECTION_PATTERNS, MIN_MESSAGE_LENGTH, type CorrectionPattern } from "./constants"

export interface DetectedCorrection {
  pattern: CorrectionPattern
  matchedText: string
}

/**
 * Strip code blocks and system reminders from text before scanning.
 * We only want to detect corrections in CK's natural language, not in code or system content.
 */
function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<!-- OMO_INTERNAL_INITIATOR -->/g, "")
    .trim()
}

/**
 * Detect correction patterns in user message text.
 * Returns all matched patterns with severity and matched text.
 */
export function detectCorrections(text: string): DetectedCorrection[] {
  if (text.length < MIN_MESSAGE_LENGTH) return []

  const cleaned = cleanText(text)
  if (cleaned.length < MIN_MESSAGE_LENGTH) return []

  const matches: DetectedCorrection[] = []

  for (const pattern of CORRECTION_PATTERNS) {
    const match = cleaned.match(pattern.pattern)
    if (match) {
      matches.push({
        pattern,
        matchedText: match[0],
      })
    }
  }

  return matches
}

/**
 * Get the highest severity from a set of detected corrections.
 */
export function highestSeverity(corrections: DetectedCorrection[]): "hard" | "soft" | null {
  if (corrections.length === 0) return null
  return corrections.some((c) => c.pattern.severity === "hard") ? "hard" : "soft"
}
