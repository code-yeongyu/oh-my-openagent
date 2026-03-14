export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

// Re-export from submodules
export { isPlannerAgent, getUltraworkMessage } from "./ultrawork"
export { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
export { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"
export { TMUX_SCRIPT_PATTERN, TMUX_SCRIPT_MESSAGE } from "./tmux-script"
export { WATCH_GITHUB_ISSUES_PATTERN, WATCH_GITHUB_ISSUES_MESSAGE } from "./watch-github-issues"

import { getUltraworkMessage } from "./ultrawork"
import { SEARCH_PATTERN, SEARCH_MESSAGE } from "./search"
import { ANALYZE_PATTERN, ANALYZE_MESSAGE } from "./analyze"
import { TMUX_SCRIPT_PATTERN, TMUX_SCRIPT_MESSAGE } from "./tmux-script"
import { WATCH_GITHUB_ISSUES_PATTERN, WATCH_GITHUB_ISSUES_MESSAGE } from "./watch-github-issues"

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
  {
    pattern: TMUX_SCRIPT_PATTERN,
    message: TMUX_SCRIPT_MESSAGE,
  },
  {
    pattern: WATCH_GITHUB_ISSUES_PATTERN,
    message: WATCH_GITHUB_ISSUES_MESSAGE,
  },
]
