export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

export { isPlannerAgent, getUltraworkMessage } from "./ultrawork"
export { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
export { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"

import { getUltraworkMessage } from "./ultrawork"
import { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
import { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"

export type KeywordDetector = {
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

const DEFAULT_ULTRAWORK_ALIASES = ["ultrawork", "ulw"]

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkMessage,
  },
  {
    pattern: SEARCH_PATTERN,
    message: SEARCH_MESSAGE,
  },
  {
    pattern: ANALYZE_PATTERN,
    message: ANALYZE_MESSAGE,
  },
]

export function createKeywordDetectors(extraUltraworkAliases?: string[]): KeywordDetector[] {
  const allAliases = extraUltraworkAliases
    ? [
        ...DEFAULT_ULTRAWORK_ALIASES,
        ...extraUltraworkAliases
          .map((a) => a.trim())
          .filter((a) => a.length > 0)
          .map(escapeRegExp),
      ]
    : DEFAULT_ULTRAWORK_ALIASES
  const ultraworkPattern = new RegExp(`\\b(${allAliases.join("|")})\\b`, "i")

  return [
    { pattern: ultraworkPattern, message: getUltraworkMessage },
    { pattern: SEARCH_PATTERN, message: SEARCH_MESSAGE },
    { pattern: ANALYZE_PATTERN, message: ANALYZE_MESSAGE },
  ]
}
