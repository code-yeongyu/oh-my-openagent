import type { FallbackEntry } from "@oh-my-opencode/model-core"
import { getAgentConfigKey } from "@oh-my-opencode/agent-config-core"
import { AGENT_MODEL_REQUIREMENTS } from "@oh-my-opencode/model-core"
import type {
  FallbackLogger,
  FallbackResult,
  ModelFallbackState,
  ReachabilityChecker,
} from "./types"

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

function isSameFailedModel(
  state: ModelFallbackState,
  providerID: string,
  modelID: string,
): boolean {
  return (
    state.providerID.toLowerCase() === providerID.toLowerCase() &&
    canonicalizeModelID(state.modelID) === canonicalizeModelID(modelID)
  )
}

function selectProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  if (preferredProviderID) {
    const lower = preferredProviderID.toLowerCase()
    const match = providers.find((p) => p.toLowerCase() === lower)
    if (match) return match
  }
  return providers[0] || preferredProviderID || "opencode"
}

function isNoOpFallback(
  state: ModelFallbackState,
  providerID: string,
  modelID: string,
): boolean {
  return (
    providerID.toLowerCase() === state.providerID.toLowerCase() &&
    canonicalizeModelID(modelID) === canonicalizeModelID(state.modelID)
  )
}

export type ModelFallbackStateController = {
  lastToastKey: Map<string, string>
  setSessionFallbackChain: (
    sessionID: string,
    fallbackChain: FallbackEntry[] | undefined,
  ) => void
  getSessionFallbackChain: (sessionID: string) => FallbackEntry[] | undefined
  clearSessionFallbackChain: (sessionID: string) => void
  setPendingModelFallback: (
    sessionID: string,
    agentName: string,
    currentProviderID: string,
    currentModelID: string,
  ) => boolean
  getNextFallback: (sessionID: string) => FallbackResult | null
  clearPendingModelFallback: (sessionID: string) => void
  hasPendingModelFallback: (sessionID: string) => boolean
  getFallbackState: (sessionID: string) => ModelFallbackState | undefined
  reset: () => void
}

export type CreateStateControllerInput = {
  pendingModelFallbacks: Map<string, ModelFallbackState>
  lastToastKey: Map<string, string>
  sessionFallbackChains: Map<string, FallbackEntry[]>
  reachabilityChecker?: ReachabilityChecker
  logger?: FallbackLogger
}

/**
 * Creates a pure finite state controller for model fallback.
 *
 * State machine per session:
 *   idle -> armed: setPendingModelFallback() when model error detected
 *   armed -> idle: getNextFallback() succeeds
 *   armed -> exhausted: no reachable fallbacks remain
 *   exhausted -> armed: setPendingModelFallback() re-arms
 *   any -> idle: clearPendingModelFallback()
 *
 * The reachability checker is injected by the harness adapter.
 * Default: all entries are reachable (no filtering).
 */
export function createModelFallbackStateController(
  input: CreateStateControllerInput,
): ModelFallbackStateController {
  const { pendingModelFallbacks, lastToastKey, sessionFallbackChains } = input

  const isReachable: ReachabilityChecker = input.reachabilityChecker ?? (() => true)
  const log: FallbackLogger = input.logger ?? (() => {})

  function setSessionFallbackChain(
    sessionID: string,
    fallbackChain: FallbackEntry[] | undefined,
  ): void {
    if (!sessionID) return
    if (fallbackChain?.length) {
      sessionFallbackChains.set(sessionID, [...fallbackChain])
    } else {
      sessionFallbackChains.delete(sessionID)
    }
  }

  function clearSessionFallbackChain(sessionID: string): void {
    sessionFallbackChains.delete(sessionID)
  }

  function getSessionFallbackChain(sessionID: string): FallbackEntry[] | undefined {
    const fallbackChain = sessionFallbackChains.get(sessionID)
    return fallbackChain ? [...fallbackChain] : undefined
  }

  function setPendingModelFallback(
    sessionID: string,
    agentName: string,
    currentProviderID: string,
    currentModelID: string,
  ): boolean {
    const agentKey = getAgentConfigKey(agentName)
    const requirements = AGENT_MODEL_REQUIREMENTS[agentKey]
    const fallbackChain = sessionFallbackChains.get(sessionID) ?? requirements?.fallbackChain

    if (!fallbackChain?.length) {
      log(`[model-fallback] No fallback chain for agent: ${agentName} (key: ${agentKey})`)
      return false
    }

    const existing = pendingModelFallbacks.get(sessionID)
    if (!existing) {
      pendingModelFallbacks.set(sessionID, {
        providerID: currentProviderID,
        modelID: currentModelID,
        fallbackChain,
        attemptCount: 0,
        pending: true,
      })
      log(`[model-fallback] Set pending fallback for session: ${sessionID}, agent: ${agentName}`)
      return true
    }

    if (existing.pending) {
      log(`[model-fallback] Pending fallback already armed for session: ${sessionID}`)
      return false
    }

    if (existing.attemptCount > 0 && isSameFailedModel(existing, currentProviderID, currentModelID)) {
      log(`[model-fallback] Ignoring duplicate fallback arm for already handled model in session: ${sessionID}`)
      return false
    }

    existing.fallbackChain = fallbackChain
    existing.providerID = currentProviderID
    existing.modelID = currentModelID
    existing.attemptCount = 0
    existing.pending = true
    log(`[model-fallback] Re-armed pending fallback for session: ${sessionID}`)
    return true
  }

  function getNextFallback(sessionID: string): FallbackResult | null {
    const state = pendingModelFallbacks.get(sessionID)
    if (!state?.pending) return null

    while (state.attemptCount < state.fallbackChain.length) {
      const attemptCount = state.attemptCount
      const fallback = state.fallbackChain[attemptCount]
      state.attemptCount++

      if (!isReachable(fallback)) {
        log(`[model-fallback] Skipping unreachable fallback for session: ${sessionID}, attempt: ${attemptCount}, model: ${fallback.model}`)
        continue
      }

      const providerID = selectProvider(fallback.providers, state.providerID)
      const modelID = fallback.model

      if (isNoOpFallback(state, providerID, modelID)) {
        log(`[model-fallback] Skipping no-op fallback for session: ${sessionID}, attempt: ${attemptCount}, model: ${fallback.model}`)
        continue
      }

      state.pending = false
      pendingModelFallbacks.delete(sessionID)
      log(`[model-fallback] Using fallback for session: ${sessionID}, attempt: ${attemptCount}, model: ${fallback.model}`)

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

    log(`[model-fallback] No more fallbacks for session: ${sessionID}`)
    pendingModelFallbacks.delete(sessionID)
    return null
  }

  function clearPendingModelFallback(sessionID: string): void {
    pendingModelFallbacks.delete(sessionID)
    lastToastKey.delete(sessionID)
  }

  function hasPendingModelFallback(sessionID: string): boolean {
    return pendingModelFallbacks.get(sessionID)?.pending === true
  }

  function getFallbackState(sessionID: string): ModelFallbackState | undefined {
    return pendingModelFallbacks.get(sessionID)
  }

  function reset(): void {
    pendingModelFallbacks.clear()
    lastToastKey.clear()
    sessionFallbackChains.clear()
  }

  return {
    lastToastKey,
    setSessionFallbackChain,
    getSessionFallbackChain,
    clearSessionFallbackChain,
    setPendingModelFallback,
    getNextFallback,
    clearPendingModelFallback,
    hasPendingModelFallback,
    getFallbackState,
    reset,
  }
}
