import { findMostSpecificFallbackEntry } from "../../shared/fallback-chain-from-models"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { DelegatedModelConfig } from "./types"

export function resolveEffectiveFallbackEntry(input: {
  categoryModel: DelegatedModelConfig | undefined
  configuredFallbackChain: FallbackEntry[] | undefined
  resolution:
    | { skipped: true }
    | { fallbackEntry?: FallbackEntry; matchedFallback?: boolean }
    | undefined
}): FallbackEntry | undefined {
  const { categoryModel, configuredFallbackChain, resolution } = input

  const resolutionSkipped = resolution && "skipped" in resolution
  const resolvedFallbackEntry = resolution && !resolutionSkipped ? resolution.fallbackEntry : undefined
  const matchedFallback = resolution && !resolutionSkipped ? resolution.matchedFallback === true : false

  if (!matchedFallback || !categoryModel) {
    return undefined
  }

  return resolvedFallbackEntry
    ?? (configuredFallbackChain
      ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, configuredFallbackChain)
      : undefined)
}
