import type { FallbackEntry } from "../../shared/model-requirements"
import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"
import { resolveFirstAvailableFallback } from "../../shared/fallback-model-availability"
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

function buildAvailableModelsFromCache(): Set<string> {
  const providerModelsCache = readProviderModelsCache()
  if (!providerModelsCache?.models) return new Set<string>()

  const connected = new Set(providerModelsCache.connected)
  const out = new Set<string>()

  for (const [providerID, models] of Object.entries(providerModelsCache.models)) {
    if (!connected.has(providerID)) continue

    for (const item of models) {
      const modelID = typeof item === "string" ? item : item?.id
      if (!modelID) continue
      out.add(`${providerID}/${modelID}`)
    }
  }

  return out
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
  const availableModels = buildAvailableModelsFromCache()

  while (state.attemptCount < state.fallbackChain.length) {
    const attemptCount = state.attemptCount
    const fallback = state.fallbackChain[attemptCount]
    state.attemptCount++

    if (!isReachable(fallback)) {
      log("[model-fallback] Skipping unreachable fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    let providerID: string
    let modelID: string

    if (availableModels.size > 0) {
      const resolved = resolveFirstAvailableFallback([fallback], availableModels)
      if (!resolved) {
        log("[model-fallback] Skipping unavailable fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
        continue
      }

      providerID = resolved.provider
      modelID = resolved.model.split("/").slice(1).join("/")
    } else {
      providerID = selectFallbackProvider(fallback.providers, state.providerID)
      modelID = transformModelForProvider(providerID, fallback.model)
    }

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
