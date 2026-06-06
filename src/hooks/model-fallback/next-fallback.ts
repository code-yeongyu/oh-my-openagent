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

type ResolvedFallback = {
  providerID: string
  modelID: string
  variant?: string
  reasoningEffort?: string
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

type FallbackCandidateDecision =
  | { kind: "unreachable" }
  | { kind: "no-op" }
  | { kind: "provider-locked" }
  | { kind: "eligible"; fallback: ResolvedFallback }

function createReachabilityChecker(state: ModelFallbackState): (entry: FallbackEntry) => boolean {
  const providerModelsCache = readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? readConnectedProvidersCache()
  const connectedSet = connectedProviders
    ? new Set(connectedProviders.map((provider: string) => provider.toLowerCase()))
    : null

  return (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true

    if (entry.providers.some((provider: string) => connectedSet.has(provider.toLowerCase()))) {
      return true
    }

    return connectedSet.has(state.providerID.toLowerCase())
  }
}

function evaluateFallbackCandidate(
  state: ModelFallbackState,
  fallback: FallbackEntry,
  isReachable: (entry: FallbackEntry) => boolean,
): FallbackCandidateDecision {
  if (!isReachable(fallback)) return { kind: "unreachable" }

  const providerID = selectFallbackProvider(fallback.providers, state.providerID)
  const modelID = transformModelForProvider(providerID, fallback.model)
  const isNoOpFallback =
    providerID.toLowerCase() === state.providerID.toLowerCase()
    && canonicalizeModelID(modelID) === canonicalizeModelID(state.modelID)

  if (isNoOpFallback) return { kind: "no-op" }

  if (state.requiresProviderSwitch && providerID.toLowerCase() === state.providerID.toLowerCase()) {
    return { kind: "provider-locked" }
  }

  return {
    kind: "eligible",
    fallback: {
      providerID,
      modelID,
      variant: fallback.variant,
      reasoningEffort: fallback.reasoningEffort,
      temperature: fallback.temperature,
      top_p: fallback.top_p,
      maxTokens: fallback.maxTokens,
      thinking: fallback.thinking,
    },
  }
}

export function getNextReachableFallback(
  sessionID: string,
  state: ModelFallbackState,
): ResolvedFallback | null {
  const isReachable = createReachabilityChecker(state)

  while (state.attemptCount < state.fallbackChain.length) {
    const attemptCount = state.attemptCount
    const fallback = state.fallbackChain[attemptCount]
    state.attemptCount++
    const decision = evaluateFallbackCandidate(state, fallback, isReachable)

    if (decision.kind === "unreachable") {
      log("[model-fallback] Skipping unreachable fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    if (decision.kind === "no-op") {
      log("[model-fallback] Skipping no-op fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    if (decision.kind === "provider-locked") {
      log("[model-fallback] Skipping same-provider fallback for provider-scoped error for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    state.pending = false
    log("[model-fallback] Using fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)

    return decision.fallback
  }

  return null
}

export function hasEligibleFallback(state: ModelFallbackState): boolean {
  const isReachable = createReachabilityChecker(state)

  for (let attemptCount = state.attemptCount; attemptCount < state.fallbackChain.length; attemptCount++) {
    const decision = evaluateFallbackCandidate(state, state.fallbackChain[attemptCount], isReachable)
    if (decision.kind === "eligible") return true
  }

  return false
}
