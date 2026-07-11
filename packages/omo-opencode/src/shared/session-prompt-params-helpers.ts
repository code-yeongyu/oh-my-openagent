import { clearSessionPromptParams, setSessionPromptParams } from "./session-prompt-params-state"

type PromptParamModel = {
  temperature?: number
  topP?: number
  reasoningEffort?: string
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

export function applySessionPromptParams(
  sessionID: string,
  model: PromptParamModel | undefined,
): void {
  if (!model) {
    clearSessionPromptParams(sessionID)
    return
  }

  const promptOptions: Record<string, unknown> = {
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(model.thinking ? { thinking: model.thinking } : {}),
  }

  setSessionPromptParams(sessionID, {
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.topP !== undefined ? { topP: model.topP } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  })
}
