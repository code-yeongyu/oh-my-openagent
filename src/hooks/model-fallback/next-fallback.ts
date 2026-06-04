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

  return (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true

    if (entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))) {
      return true
    }

    return connectedSet.has(state.providerID.toLowerCase())
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
