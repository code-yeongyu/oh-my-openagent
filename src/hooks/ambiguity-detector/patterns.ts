import type { AmbiguityReason, AmbiguityResult, MessagePart } from "./types"

export const VAGUE_ACTION_VERBS = [
  "fix",
  "update",
  "change",
  "improve",
  "optimize",
  "refactor",
  "clean",
]

export const VAGUE_REQUIREMENT_PHRASES = [
  "make it better",
  "improve this",
  "optimize this",
  "make it faster",
  "clean this up",
]

const FILE_PATH_PATTERN =
  /(?:\b[\w.-]+\/[\w./-]*\.[\w]+(?::\d+(?::\d+)?)?|\b[\w.-]+\.[\w]+(?::\d+(?::\d+)?)?)/i
const LINE_REFERENCE_PATTERN = /#L\d+(?:C\d+)?|\bline\s+\d+\b|:\d+(?::\d+)?/i
const FUNCTION_PATTERN = /\b[a-zA-Z_]\w*\s*\(/i
const METRIC_PATTERN = /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds?|minutes?|%|percent|kb|mb|gb|x)\b/i
const MULTIPLE_INTERPRETATION_PATTERN = /\b(?:or|maybe|something|whatever|somehow|etc)\b/i

export function extractPromptText(parts: MessagePart[]): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .trim()
}

export function detectAmbiguity(text: string): AmbiguityResult {
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean)
  const hasFilePath = FILE_PATH_PATTERN.test(text)
  const hasLineReference = LINE_REFERENCE_PATTERN.test(text)
  const hasFunction = FUNCTION_PATTERN.test(text)
  const hasScope = hasFilePath || hasLineReference || hasFunction
  const hasVagueVerb = VAGUE_ACTION_VERBS.some((verb) => new RegExp(`\\b${verb}\\b`, "i").test(lower))
  const hasVaguePhrase = VAGUE_REQUIREMENT_PHRASES.some((phrase) => lower.includes(phrase))
  const hasMetric = METRIC_PATTERN.test(lower)

  const reasons: AmbiguityReason[] = []

  if (words.length > 0 && words.length < 15 && !hasFilePath) {
    reasons.push("short-prompt")
  }

  if (hasVagueVerb && !hasScope) {
    reasons.push("missing-goal")
  }

  if (!hasScope) {
    reasons.push("missing-scope")
  }

  if (hasVaguePhrase && !hasMetric) {
    reasons.push("vague-requirements")
  }

  if (MULTIPLE_INTERPRETATION_PATTERN.test(lower) && !hasScope) {
    reasons.push("multiple-interpretations")
  }

  const uniqueReasons = [...new Set(reasons)]
  return {
    ambiguous: uniqueReasons.length > 0,
    reasons: uniqueReasons,
  }
}
