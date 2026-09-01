import { lowerReasoningForModel } from "./agent-variant"
import type { LoweredReasoning } from "./agent-variant"
import { clearSessionPromptParams, setSessionPromptParams } from "./session-prompt-params-state"

type PromptParamModel = {
  providerID?: string
  modelID?: string
  runtimeModel?: Record<string, unknown>
  temperature?: number
  top_p?: number
  reasoning?: string
  reasoningEffort?: string
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

export function applySessionPromptParams(
  sessionID: string,
  model: PromptParamModel | undefined,
): LoweredReasoning {
  if (!model) {
    clearSessionPromptParams(sessionID)
    return {}
  }

  const loweredReasoning = model.reasoning !== undefined
    ? lowerReasoningForModel(model.reasoning, {
        providerID: model.providerID ?? "",
        modelID: model.modelID ?? "",
        runtimeModel: model.runtimeModel,
      })
    : undefined
  const reasoningEffort = model.reasoning !== undefined
    ? loweredReasoning?.reasoningEffort
    : model.reasoningEffort
  const promptOptions: Record<string, unknown> = {
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(model.thinking ? { thinking: model.thinking } : {}),
  }

  setSessionPromptParams(sessionID, {
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.top_p !== undefined ? { topP: model.top_p } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  })

  return loweredReasoning ?? {}
}
