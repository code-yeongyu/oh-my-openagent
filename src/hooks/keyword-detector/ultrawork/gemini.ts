import geminiPrompt from "../../../../packages/prompts-core/prompts/ultrawork/gemini.md" with { type: "text" }

export const ULTRAWORK_GEMINI_MESSAGE = geminiPrompt

export function getGeminiUltraworkMessage(): string {
  return ULTRAWORK_GEMINI_MESSAGE
}
