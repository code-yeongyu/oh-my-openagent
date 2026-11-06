import type { OmoCategoryConfig, OmoFallbackModelObject, OmoFallbackModels } from "@oh-my-opencode/omo-config-core"

import type { ModelChainCandidate } from "../model-chain"

function fallbackObjectToString(fallback: OmoFallbackModelObject): string {
  return fallback.variant ? `${fallback.model} ${fallback.variant}` : fallback.model
}
export function flattenFallbackModels(fallbackModels: OmoFallbackModels | undefined): readonly string[] | undefined {
  if (fallbackModels === undefined) {
    return undefined
  }
  if (typeof fallbackModels === "string") {
    return [fallbackModels]
  }
  return fallbackModels.map((fallback) => typeof fallback === "string" ? fallback : fallbackObjectToString(fallback))
}
export function categoryModelCandidates(config: OmoCategoryConfig): readonly ModelChainCandidate[] {
  // Canonical models[] wins over the legacy model + fallback_models branch: entry zero is the
  // primary model and the rest become the ordered runtime fallback chain.
  if (config.models !== undefined && config.models.length > 0) {
    return config.models.map((entry): ModelChainCandidate => {
      if (typeof entry === "string") return { model: entry }
      return {
        model: entry.model,
        ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
        ...(entry.reasoning !== undefined ? { reasoningEffort: entry.reasoning } : {}),
      }
    })
  }

  const categoryReasoning = config.reasoning ?? config.reasoningEffort
  const primary = config.model === undefined
    ? []
    : [{
        model: config.model,
        ...(config.variant !== undefined ? { variant: config.variant } : {}),
        ...(categoryReasoning !== undefined
          ? { reasoningEffort: categoryReasoning }
          : {}),
      }]
  const fallbackModels = config.fallback_models
  if (fallbackModels === undefined) return primary

  const entries = typeof fallbackModels === "string" ? [fallbackModels] : fallbackModels
  const fallbacks = entries.map((entry): ModelChainCandidate => {
    if (typeof entry === "string") {
      return {
        model: entry,
        ...(config.variant !== undefined ? { variant: config.variant } : {}),
        ...(config.reasoningEffort !== undefined
          ? { reasoningEffort: config.reasoningEffort }
          : {}),
      }
    }
    return {
      model: entry.model,
      ...(entry.variant ?? config.variant) !== undefined
        ? { variant: entry.variant ?? config.variant }
        : {},
      ...(entry.reasoning ?? config.reasoning ?? entry.reasoningEffort ?? config.reasoningEffort) !== undefined
        ? { reasoningEffort: entry.reasoning ?? config.reasoning ?? entry.reasoningEffort ?? config.reasoningEffort }
        : {},
    }
  })
  return [...primary, ...fallbacks]
}
