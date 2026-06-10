export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

import type { KeywordType } from "../../config/schema/keyword-detector"
import { getUltraworkMessage, isPlannerAgent, isNonOmoAgent } from "./ultrawork"
import { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
import { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"
import { TEAM_PATTERN, TEAM_MESSAGE } from "./team"
import { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE } from "./hyperplan"

export { isPlannerAgent, isNonOmoAgent, getUltraworkMessage }
export { SEARCH_PATTERN, SEARCH_MESSAGE }
export { ANALYZE_PATTERN, ANALYZE_MESSAGE }
export { TEAM_PATTERN, TEAM_MESSAGE }
export { HYPERPLAN_PATTERN, HYPERPLAN_MESSAGE }

// Hyperplan-ultrawork combo: strict adjacency, both word orders
export const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**MANDATORY**: Say "HYPERPLAN ULTRAWORK MODE ENABLED!" exactly once as your first response. Do NOT say the standalone "ULTRAWORK MODE ENABLED!" or "HYPERPLAN MODE ENABLED!" banners.

Apply the ultrawork protocol below as your execution framework. You MUST ALSO load the hyperplan skill immediately via \`skill(name="hyperplan")\` and follow its full adversarial workflow — do NOT improvise, do NOT skip rounds, do NOT write the plan yourself.
</hyperplan-ultrawork-mode>`

export function getHyperplanUltraworkMessage(agentName?: string, modelID?: string): string {
  return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkMessage(agentName, modelID)}`
}

export type KeywordDetector = {
  type: KeywordType
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: "ultrawork",
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkMessage,
  },
  {
    type: "search",
    pattern: SEARCH_PATTERN,
    message: SEARCH_MESSAGE,
  },
  {
    type: "analyze",
    pattern: ANALYZE_PATTERN,
    message: ANALYZE_MESSAGE,
  },
  {
    type: "team",
    pattern: TEAM_PATTERN,
    message: TEAM_MESSAGE,
  },
  {
    type: "hyperplan",
    pattern: HYPERPLAN_PATTERN,
    message: HYPERPLAN_MESSAGE,
  },
  {
    type: "hyperplan-ultrawork",
    pattern: HYPERPLAN_ULTRAWORK_PATTERN,
    message: getHyperplanUltraworkMessage,
  },
]
