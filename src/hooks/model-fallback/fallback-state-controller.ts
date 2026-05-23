import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { log } from "../../shared/logger"
import { getNextReachableFallback } from "./next-fallback"

type ModelFallbackStateLike = {
  providerID: string
  modelID: string
  fallbackChain: FallbackEntry[]
  attemptCount: number
  pending: boolean
}

function canonicalizeModelIDForDuplicateCheck(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

function isSameFailedModel(
  state: ModelFallbackStateLike,
  providerID: string,
  modelID: string,
): boolean {
  return state.providerID.toLowerCase() === providerID.toLowerCase()
    && canonicalizeModelIDForDuplicateCheck(state.modelID) === canonicalizeModelIDForDuplicateCheck(modelID)
}

function isProviderNameDisabled(
  providerID: string | undefined,
  disabledProviders: readonly string[] | undefined,
): boolean {
  if (!providerID || !disabledProviders || disabledProviders.length === 0) return false

  const provider = providerID.trim().toLowerCase()
  if (!provider) return false

  return disabledProviders.some((entry) => entry.trim().toLowerCase() === provider)
}

function filterDisabledProvidersFromFallbackChain(
  fallbackChain: readonly FallbackEntry[] | undefined,
  disabledProviders: readonly string[] | undefined,
): FallbackEntry[] | undefined {
  if (!fallbackChain) return undefined
  if (!disabledProviders || disabledProviders.length === 0) return [...fallbackChain]

  const filteredChain = fallbackChain
    .map((entry) => ({
      ...entry,
      providers: entry.providers.filter((provider) => !isProviderNameDisabled(provider, disabledProviders)),
    }))
    .filter((entry) => entry.providers.length > 0)

  return filteredChain.length > 0 ? filteredChain : undefined
}

export type ModelFallbackStateController = {
  lastToastKey: Map<string, string>
  setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void
  getSessionFallbackChain: (sessionID: string) => FallbackEntry[] | undefined
  clearSessionFallbackChain: (sessionID: string) => void
  setPendingModelFallback: (
    sessionID: string,
    agentName: string,
    currentProviderID: string,
    currentModelID: string,
  ) => boolean
  getNextFallback: (sessionID: string) => ReturnType<typeof getNextReachableFallback>
  clearPendingModelFallback: (sessionID: string) => void
  hasPendingModelFallback: (sessionID: string) => boolean
  getFallbackState: (sessionID: string) => ModelFallbackStateLike | undefined
  reset: () => void
}

export function createModelFallbackStateController(input: {
  pendingModelFallbacks: Map<string, ModelFallbackStateLike>
  lastToastKey: Map<string, string>
  sessionFallbackChains: Map<string, FallbackEntry[]>
  disabledProviders?: readonly string[]
}): ModelFallbackStateController {
  const { pendingModelFallbacks, lastToastKey, sessionFallbackChains, disabledProviders } = input

  function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void {
    if (!sessionID) return
    const filteredFallbackChain = filterDisabledProvidersFromFallbackChain(fallbackChain, disabledProviders)
    sessionFallbackChains.set(sessionID, filteredFallbackChain?.length ? filteredFallbackChain : [])
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
    const fallbackChain = sessionFallbackChains.get(sessionID)
      ?? filterDisabledProvidersFromFallbackChain(requirements?.fallbackChain, disabledProviders)

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

    existing.providerID = currentProviderID
    existing.modelID = currentModelID
    existing.pending = true
    if (existing.attemptCount >= existing.fallbackChain.length) {
      log(`[model-fallback] Fallback chain exhausted for session: ${sessionID}`)
      return false
    }
    log(`[model-fallback] Re-armed pending fallback for session: ${sessionID}`)
    return true
  }

  function getNextFallback(sessionID: string): ReturnType<typeof getNextReachableFallback> {
    const state = pendingModelFallbacks.get(sessionID)
    if (!state?.pending) return null

    const fallback = getNextReachableFallback(sessionID, state)
    if (fallback) return fallback

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

  function getFallbackState(sessionID: string): ModelFallbackStateLike | undefined {
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
