import defaultPrompt from "../../../../packages/prompts-core/prompts/ultrawork/default.md" with { type: "text" }

export const ULTRAWORK_DEFAULT_MESSAGE = defaultPrompt

export function getDefaultUltraworkMessage(): string {
  return ULTRAWORK_DEFAULT_MESSAGE
}
