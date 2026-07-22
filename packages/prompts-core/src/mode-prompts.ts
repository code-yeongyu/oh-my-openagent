import hyperplanModePrompt from "../prompts/mode/hyperplan.md" with { type: "text" }
import teamModePrompt from "../prompts/mode/team.md" with { type: "text" }
import analyzeModePrompt from "../prompts/mode/analyze.md" with { type: "text" }
import searchModePrompt from "../prompts/mode/search.md" with { type: "text" }

export const HYPERPLAN_MODE_PROMPT = stripFinalLineFeed(hyperplanModePrompt)
export const TEAM_MODE_PROMPT = stripFinalLineFeed(teamModePrompt)
export const ANALYZE_MODE_PROMPT = stripFinalLineFeed(analyzeModePrompt)
export const SEARCH_MODE_PROMPT = stripFinalLineFeed(searchModePrompt)

function stripFinalLineFeed(prompt: string): string {
  return prompt.endsWith("\n") ? prompt.slice(0, -1) : prompt
}
