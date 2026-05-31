import { clearSessionPromptParams, setSessionPromptParams } from "./session-prompt-params-state"

type PromptParamModel = {
  temperature?: number
  top_p?: number
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
    ...(model.top_p !== undefined ? { topP: model.top_p } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  })
}
