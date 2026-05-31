import gptPrompt from "../../../../packages/prompts-core/prompts/ultrawork/gpt.md" with { type: "text" }

export const ULTRAWORK_GPT_MESSAGE = gptPrompt

export function getGptUltraworkMessage(): string {
  return ULTRAWORK_GPT_MESSAGE
}
