import type { DelegatedModelConfig } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"

export function applyFallbackEntrySettings(input: {
  categoryModel: DelegatedModelConfig
  effectiveEntry: FallbackEntry
  variantOverride?: string
}): DelegatedModelConfig {
  const { categoryModel, effectiveEntry, variantOverride } = input

  return {
    ...categoryModel,
    variant: variantOverride ?? effectiveEntry.variant ?? categoryModel.variant,
    reasoningEffort: effectiveEntry.reasoningEffort ?? categoryModel.reasoningEffort,
    temperature: effectiveEntry.temperature ?? categoryModel.temperature,
    top_p: effectiveEntry.top_p ?? categoryModel.top_p,
    maxTokens: effectiveEntry.maxTokens ?? categoryModel.maxTokens,
    thinking: effectiveEntry.thinking ?? categoryModel.thinking,
  }
}
