export { CODE_BLOCK_PATTERN, INLINE_CODE_PATTERN } from "../../shared"
export { ANALYZE_MESSAGE, ANALYZE_PATTERN } from "./analyze"
export { SEARCH_MESSAGE, SEARCH_PATTERN } from "./search"
// Re-export from submodules
export { getUltraworkMessage, isPlannerAgent } from "./ultrawork"

import { ANALYZE_MESSAGE, ANALYZE_PATTERN } from "./analyze"
import { SEARCH_MESSAGE, SEARCH_PATTERN } from "./search"
import { getUltraworkMessage } from "./ultrawork"

export type KeywordDetector = {
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
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
