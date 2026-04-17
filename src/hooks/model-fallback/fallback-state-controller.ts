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

export type ModelFallbackStateController = {
  lastToastKey: Map<string, string>
  setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void
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
}): ModelFallbackStateController {
  const { pendingModelFallbacks, lastToastKey, sessionFallbackChains } = input

  function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void {
    if (!sessionID) return
    sessionFallbackChains.set(sessionID, fallbackChain?.length ? fallbackChain : [])
  }

  function clearSessionFallbackChain(sessionID: string): void {
    sessionFallbackChains.delete(sessionID)
  }

  function setPendingModelFallback(
    sessionID: string,
    agentName: string,
    currentProviderID: string,
    currentModelID: string,
  ): boolean {
    const agentKey = getAgentConfigKey(agentName)
    const requirements = AGENT_MODEL_REQUIREMENTS[agentKey]
    const fallbackChain = sessionFallbackChains.has(sessionID)
      ? sessionFallbackChains.get(sessionID)
      : requirements?.fallbackChain

    if (!fallbackChain?.length) {
      log("[model-fallback] No fallback chain for agent: " + agentName + " (key: " + agentKey + ")")
      return false
    }

    const existing = pendingModelFallbacks.get(sessionID)
    if (existing) {
      if (existing.pending) {
        log("[model-fallback] Pending fallback already armed for session: " + sessionID)
        return false
      }
      existing.providerID = currentProviderID
      existing.modelID = currentModelID
      existing.pending = true
      if (existing.attemptCount >= existing.fallbackChain.length) {
        log("[model-fallback] Fallback chain exhausted for session: " + sessionID)
        return false
      }
      log("[model-fallback] Re-armed pending fallback for session: " + sessionID)
      return true
    }

    pendingModelFallbacks.set(sessionID, {
      providerID: currentProviderID,
      modelID: currentModelID,
      fallbackChain,
      attemptCount: 0,
      pending: true,
    })
    log("[model-fallback] Set pending fallback for session: " + sessionID + ", agent: " + agentName)
    return true
  }

  function getNextFallback(sessionID: string): ReturnType<typeof getNextReachableFallback> {
    const state = pendingModelFallbacks.get(sessionID)
    if (!state?.pending) return null

    const fallback = getNextReachableFallback(sessionID, state)
    if (fallback) return fallback

    log("[model-fallback] No more fallbacks for session: " + sessionID)
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
    clearSessionFallbackChain,
    setPendingModelFallback,
    getNextFallback,
    clearPendingModelFallback,
    hasPendingModelFallback,
    getFallbackState,
    reset,
  }
}
