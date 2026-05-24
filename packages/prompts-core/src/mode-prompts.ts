import analyzeModePrompt from "../prompts/mode/analyze.md" with { type: "text" }
import searchModePrompt from "../prompts/mode/search.md" with { type: "text" }

export const ANALYZE_MODE_PROMPT = stripFinalLineFeed(analyzeModePrompt)
export const SEARCH_MODE_PROMPT = stripFinalLineFeed(searchModePrompt)

function stripFinalLineFeed(prompt: string): string {
  return prompt.endsWith("\n") ? prompt.slice(0, -1) : prompt
}
