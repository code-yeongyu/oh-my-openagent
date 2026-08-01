import { SettingsManager } from "@code-yeongyu/senpi"

import type { ResolvedModelRecord } from "../../state"

export function createRuntimeFallbackSettings(
  selectedModel: string | undefined,
  fallbackModels: readonly ResolvedModelRecord[] | undefined,
): SettingsManager {
  if (selectedModel === undefined || fallbackModels === undefined || fallbackModels.length === 0) {
    return SettingsManager.inMemory({
      retry: {
        modelFallback: false,
      },
    })
  }
  return SettingsManager.inMemory({
    retry: {
      modelFallback: true,
      fallbackChains: {
        [selectedModel]: fallbackModels.map(modelSelector),
      },
    },
  })
}

function modelSelector(model: ResolvedModelRecord): string {
  const thinking = model.reasoning ?? model.reasoning_effort ?? model.variant
  return thinking === undefined
    ? `${model.provider}/${model.model_id}`
    : `${model.provider}/${model.model_id}:${thinking}`
}
