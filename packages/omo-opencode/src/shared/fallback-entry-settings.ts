import type { FallbackEntry } from "./model-requirements"
import type { DelegatedModelConfig } from "./model-resolution-types"

export function applyFallbackEntrySettings(input: {
  categoryModel: DelegatedModelConfig
  effectiveEntry: FallbackEntry
  variantOverride?: string
}): DelegatedModelConfig {
  const { categoryModel, effectiveEntry, variantOverride } = input
  const providerOptions = {
    ...categoryModel.providerOptions,
    ...effectiveEntry.providerOptions,
  }

  return {
    ...categoryModel,
    variant: variantOverride ?? effectiveEntry.variant ?? categoryModel.variant,
    reasoning: effectiveEntry.reasoning ?? categoryModel.reasoning,
    reasoningEffort: effectiveEntry.reasoning === undefined && categoryModel.reasoning === undefined
      ? effectiveEntry.reasoningEffort ?? categoryModel.reasoningEffort
      : categoryModel.reasoningEffort,
    temperature: effectiveEntry.temperature ?? categoryModel.temperature,
    top_p: effectiveEntry.top_p ?? categoryModel.top_p,
    maxTokens: effectiveEntry.maxTokens ?? categoryModel.maxTokens,
    providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
    thinking: effectiveEntry.thinking ?? categoryModel.thinking,
  }
}
