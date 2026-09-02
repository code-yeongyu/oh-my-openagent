import {
  filterFallbackChainByDisabledProviders,
  fuzzyMatchModel,
  transformModelForProvider,
} from "@oh-my-opencode/model-core"
import type {
  DelegateFallbackEntry,
  DelegateModelResolutionResult,
} from "./model-selection"

type DelegateFallbackResolutionInput = {
  readonly fallbackChain: readonly DelegateFallbackEntry[]
  readonly disabledProviders: readonly string[] | undefined
  readonly availableModels: ReadonlySet<string>
  readonly connectedProviders: readonly string[] | null
  readonly explicitHighModel: string | undefined
  readonly explicitHighBaseModel: string | null
  readonly log?: (message: string, metadata?: Record<string, unknown>) => void
}

function modelIDForProvider(provider: string, model: string): string {
  const prefix = `${provider}/`
  return model.startsWith(prefix) ? model.slice(prefix.length) : model
}

export function resolveDelegateFallback({
  fallbackChain,
  disabledProviders,
  availableModels,
  connectedProviders,
  explicitHighModel,
  explicitHighBaseModel,
  log,
}: DelegateFallbackResolutionInput): DelegateModelResolutionResult {
  const allowedChain = filterFallbackChainByDisabledProviders(
    fallbackChain,
    disabledProviders,
  )
  if (availableModels.size === 0) {
    if (connectedProviders) {
      const connectedSet = new Set(connectedProviders)
      for (const entry of allowedChain) {
        for (const provider of entry.providers) {
          if (!connectedSet.has(provider)) continue

          const transformedModelId = transformModelForProvider(
            provider,
            modelIDForProvider(provider, entry.model),
          )
          log?.("[resolveModelForDelegateTask] fallback chain resolved via connected provider", {
            provider,
            model: entry.model,
          })
          return {
            model: `${provider}/${transformedModelId}`,
            variant: entry.variant,
            fallbackEntry: entry,
            matchedFallback: true,
          }
        }
      }
      log?.("[resolveModelForDelegateTask] no connected provider found in fallback chain")
      return undefined
    }

    const first = allowedChain[0]
    const provider = first?.providers[0]
    return first && provider
      ? {
          model: `${provider}/${transformModelForProvider(provider, first.model)}`,
          variant: first.variant,
          fallbackEntry: first,
          matchedFallback: true,
        }
      : undefined
  }

  for (const [entryIndex, entry] of allowedChain.entries()) {
    for (const provider of entry.providers) {
      const transformedModelId = transformModelForProvider(
        provider,
        modelIDForProvider(provider, entry.model),
      )
      const match = fuzzyMatchModel(
        `${provider}/${transformedModelId}`,
        new Set(availableModels),
        [provider],
      )
      if (!match) continue

      if (explicitHighModel && entry.variant === "high" && match === explicitHighBaseModel) {
        return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
      }
      return {
        model: match,
        variant: entry.variant,
        fallbackEntry: entry,
        matchedFallback: true,
      }
    }

    const laterRungProviders = new Set(
      allowedChain
        .slice(entryIndex + 1)
        .filter((candidate) => candidate.model === entry.model)
        .flatMap((candidate) => candidate.providers),
    )
    const crossProviderCandidates = new Set(
      [...availableModels].filter((model) => {
        const [provider] = model.split("/")
        return provider !== undefined && !laterRungProviders.has(provider)
      }),
    )
    const crossProviderMatch = fuzzyMatchModel(entry.model, crossProviderCandidates)
    if (!crossProviderMatch) continue

    if (
      explicitHighModel &&
      entry.variant === "high" &&
      crossProviderMatch === explicitHighBaseModel
    ) {
      return { model: explicitHighModel, fallbackEntry: entry, matchedFallback: true }
    }
    return {
      model: crossProviderMatch,
      variant: entry.variant,
      fallbackEntry: entry,
      matchedFallback: true,
    }
  }

  return undefined
}
