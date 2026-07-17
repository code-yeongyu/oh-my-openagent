import type { FallbackEntry } from "../../shared/model-requirements"
import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"
import { selectFallbackProvider } from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { log } from "../../shared/logger"
import type { ModelFallbackState } from "./hook"

function canonicalizeModelID(modelID: string): string {
  return modelID
    .toLowerCase()
    .replace(/\./g, "-")
}

function createReachabilityChecker(state: ModelFallbackState): (entry: FallbackEntry) => boolean {
  const providerModelsCache = readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? readConnectedProvidersCache()
  const connectedSet = connectedProviders
    ? new Set(connectedProviders.map((provider) => provider.toLowerCase()))
    : null
  const currentProviderCatalogKey = providerModelsCache
    ? Object.keys(providerModelsCache.models).find(
        (provider) => provider.toLowerCase() === state.providerID.toLowerCase(),
      )
    : undefined
  const currentProviderCatalog = currentProviderCatalogKey
    ? providerModelsCache?.models[currentProviderCatalogKey]
    : undefined

  return (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true

    if (entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))) {
      return true
    }

    if (!connectedSet.has(state.providerID.toLowerCase())) {
      return false
    }

    // The rung's providers are disconnected but the current provider is
    // connected, so selectFallbackProvider would substitute it for the
    // retry. That only works when the current provider actually serves the
    // rung's model — otherwise the retry targets a nonexistent catalog id
    // (e.g. opencode-go/k3 for the kimi-for-coding-only k3 rung).
    // Stay optimistic when no catalog data is available for the provider.
    if (!currentProviderCatalog || currentProviderCatalog.length === 0) return true

    const transformed = canonicalizeModelID(transformModelForProvider(state.providerID, entry.model))
    return currentProviderCatalog.some(
      (model) => canonicalizeModelID(typeof model === "string" ? model : model.id) === transformed,
    )
  }
}

export function getNextReachableFallback(
  sessionID: string,
  state: ModelFallbackState,
): {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
} | null {
  const isReachable = createReachabilityChecker(state)

  while (state.attemptCount < state.fallbackChain.length) {
    const attemptCount = state.attemptCount
    const fallback = state.fallbackChain[attemptCount]
    state.attemptCount++

    if (!isReachable(fallback)) {
      log("[model-fallback] Skipping unreachable fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    const providerID = selectFallbackProvider(fallback.providers, state.providerID)
    const modelID = transformModelForProvider(providerID, fallback.model)
    const isNoOpFallback =
      providerID.toLowerCase() === state.providerID.toLowerCase()
      && canonicalizeModelID(modelID) === canonicalizeModelID(state.modelID)

    if (isNoOpFallback) {
      log("[model-fallback] Skipping no-op fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    state.pending = false
    log("[model-fallback] Using fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)

    return {
      providerID,
      modelID,
      variant: fallback.variant,
      reasoningEffort: fallback.reasoningEffort,
      temperature: fallback.temperature,
      top_p: fallback.top_p,
      maxTokens: fallback.maxTokens,
      thinking: fallback.thinking,
    }
  }

  return null
}
