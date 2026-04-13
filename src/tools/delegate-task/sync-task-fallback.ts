import type { FallbackEntry } from "../../shared/model-requirements"
import type { DelegatedModelConfig } from "./types"
import type { ModelFallbackState } from "../../hooks/model-fallback/hook"
import { getNextReachableFallback } from "../../hooks/model-fallback/next-fallback"

function toDelegatedModelConfig(fallback: NonNullable<ReturnType<typeof getNextReachableFallback>>): DelegatedModelConfig {
  return {
    providerID: fallback.providerID,
    modelID: fallback.modelID,
    variant: fallback.variant,
    reasoningEffort: fallback.reasoningEffort,
    temperature: fallback.temperature,
    top_p: fallback.top_p,
    maxTokens: fallback.maxTokens,
    thinking: fallback.thinking,
  }
}

export async function retrySyncPromptWithFallbacks(input: {
  sessionID: string
  initialError: string
  categoryModel: DelegatedModelConfig | undefined
  fallbackChain: FallbackEntry[] | undefined
  sendPrompt: (categoryModel: DelegatedModelConfig) => Promise<string | null>
}): Promise<{ promptError: string | null; categoryModel: DelegatedModelConfig | undefined }> {
  const { sessionID, initialError, categoryModel, fallbackChain, sendPrompt } = input

  if (!categoryModel || !fallbackChain || fallbackChain.length === 0) {
    return {
      promptError: initialError,
      categoryModel,
    }
  }

  const fallbackState: ModelFallbackState = {
    providerID: categoryModel.providerID,
    modelID: categoryModel.modelID,
    fallbackChain,
    attemptCount: 0,
    pending: true,
  }

  let finalError = initialError

  while (true) {
    const nextFallback = getNextReachableFallback(sessionID, fallbackState)
    if (!nextFallback) {
      return {
        promptError: finalError,
        categoryModel,
      }
    }

    const fallbackModel = toDelegatedModelConfig(nextFallback)
    const promptError = await sendPrompt(fallbackModel)
    if (!promptError) {
      return {
        promptError: null,
        categoryModel: fallbackModel,
      }
    }

    finalError = promptError
    fallbackState.providerID = fallbackModel.providerID
    fallbackState.modelID = fallbackModel.modelID
    fallbackState.pending = true
  }
}
