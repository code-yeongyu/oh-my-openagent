import type { SettingsManager } from "@code-yeongyu/senpi"

import { senpiBarrel } from "../../lazy/senpi-barrel"
import type { ResolvedModelRecord } from "../../state"

/** Same-model retry budget merged over the engine defaults for one child. */
export type ChildRetryOverride = {
  readonly maxRetries?: number
  readonly baseDelayMs?: number
}

export function createRuntimeFallbackSettings(
  selectedModel: string | undefined,
  fallbackModels: readonly ResolvedModelRecord[] | undefined,
  retry?: ChildRetryOverride,
): SettingsManager {
  // SettingsManager is read through the lazy barrel boundary; the only callers reach here from
  // buildChildSessionOptions inside InProcessRunner.start/resume, which already awaited
  // loadSenpiBarrel().
  const { SettingsManager: manager } = senpiBarrel()
  const retryOverride = {
    ...(retry?.maxRetries === undefined ? {} : { maxRetries: retry.maxRetries }),
    ...(retry?.baseDelayMs === undefined ? {} : { baseDelayMs: retry.baseDelayMs }),
  }
  if (selectedModel === undefined || fallbackModels === undefined || fallbackModels.length === 0) {
    return manager.inMemory({
      retry: {
        modelFallback: false,
        ...retryOverride,
      },
    })
  }
  return manager.inMemory({
    retry: {
      modelFallback: true,
      ...retryOverride,
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
