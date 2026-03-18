import { CONTINUATION_PROMPT } from "./constants"

const CONTEXT_LINE_COUNT = 5

export function buildContextualContinuationPrompt(assistantText: string): string {
  const lines = assistantText.split("\n").map((line) => line.trim()).filter(Boolean)
  const contextLines = lines.slice(-CONTEXT_LINE_COUNT)

  if (contextLines.length === 0) {
    return CONTINUATION_PROMPT
  }

  return `${CONTINUATION_PROMPT}\n\n[Your last response ended with:]\n${contextLines.join("\n")}`
}
