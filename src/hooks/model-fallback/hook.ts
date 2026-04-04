import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"
import { selectFallbackProvider } from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { log } from "../../shared/logger"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"
import { getNextReachableFallback } from "./next-fallback"

type FallbackToast = (input: {
  title: string
  message: string
  variant?: "info" | "success" | "warning" | "error"
  duration?: number
}) => void | Promise<void>

type FallbackCallback = (input: {
  sessionID: string
  providerID: string
  modelID: string
  variant?: string
}) => void | Promise<void>

export type ModelFallbackState = {
  providerID: string
  modelID: string
  fallbackChain: FallbackEntry[]
  attemptCount: number
  pending: boolean
}

/**
 * Map of sessionID -> pending model fallback state
 * When a model error occurs, we store the fallback info here.
 * The next chat.message call will use this to switch to the fallback model.
 */
const pendingModelFallbacks = new Map<string, ModelFallbackState>()
const lastToastKey = new Map<string, string>()
const sessionFallbackChains = new Map<string, FallbackEntry[]>()

export function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void {
  if (!sessionID) return
  if (!fallbackChain || fallbackChain.length === 0) {
    sessionFallbackChains.delete(sessionID)
    return
  }
  sessionFallbackChains.set(sessionID, fallbackChain)
}

export function clearSessionFallbackChain(sessionID: string): void {
  sessionFallbackChains.delete(sessionID)
}

/**
 * Sets a pending model fallback for a session.
 * Called when a model error is detected in session.error handler.
 */
export function setPendingModelFallback(
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  currentModelID: string,
): boolean {
  const agentKey = getAgentConfigKey(agentName)
  const requirements = AGENT_MODEL_REQUIREMENTS[agentKey]
  const sessionFallback = sessionFallbackChains.get(sessionID)
  const fallbackChain = sessionFallback && sessionFallback.length > 0
    ? sessionFallback
    : requirements?.fallbackChain

  if (!fallbackChain || fallbackChain.length === 0) {
    log("[model-fallback] No fallback chain for agent: " + agentName + " (key: " + agentKey + ")")
    return false
  }

  const existing = pendingModelFallbacks.get(sessionID)

  if (existing) {
    if (existing.pending) {
      log("[model-fallback] Pending fallback already armed for session: " + sessionID)
      return false
    }

    // Preserve progression across repeated session.error retries in same session.
    // We only mark the next turn as pending fallback application.
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

  const state: ModelFallbackState = {
    providerID: currentProviderID,
    modelID: currentModelID,
    fallbackChain,
    attemptCount: 0,
    pending: true,
  }

  pendingModelFallbacks.set(sessionID, state)
  log("[model-fallback] Set pending fallback for session: " + sessionID + ", agent: " + agentName)
  return true
}

/**
 * Gets the next fallback model for a session.
 * Increments attemptCount each time called.
 */
export function getNextFallback(
  sessionID: string,
): { providerID: string; modelID: string; variant?: string } | null {
  const state = pendingModelFallbacks.get(sessionID)
  if (!state) return null

  if (!state.pending) return null

  const fallback = getNextReachableFallback(sessionID, state)
  if (fallback) {
    return fallback
  }

  log("[model-fallback] No more fallbacks for session: " + sessionID)
  pendingModelFallbacks.delete(sessionID)
  return null
}

/**
 * Clears the pending fallback for a session.
 * Called after fallback is successfully applied.
 */
export function clearPendingModelFallback(sessionID: string): void {
  pendingModelFallbacks.delete(sessionID)
  lastToastKey.delete(sessionID)
}

/**
 * Checks if there's a pending fallback for a session.
 */
export function hasPendingModelFallback(sessionID: string): boolean {
  const state = pendingModelFallbacks.get(sessionID)
  return state?.pending === true
}

/**
 * Gets the current fallback state for a session (for debugging).
 */
export function getFallbackState(sessionID: string): ModelFallbackState | undefined {
  return pendingModelFallbacks.get(sessionID)
}

/**
 * Creates a chat.message hook that applies model fallbacks when pending.
 */
export function createModelFallbackHook(args?: { toast?: FallbackToast; onApplied?: FallbackCallback }) {
  const toast = args?.toast
  const onApplied = args?.onApplied

  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageHandlerOutput,
    ): Promise<void> => {
      const { sessionID } = input
      if (!sessionID) return

      const fallback = getNextFallback(sessionID)
      if (!fallback) return

      await applyFallbackToChatMessage({
        input,
        output,
        fallback,
        toast,
        onApplied,
        lastToastKey,
      })
    },
  }
}

/**
 * Resets all module-global state for testing.
 * Clears pending fallbacks, toast keys, and session chains.
 */
export function _resetForTesting(): void {
  pendingModelFallbacks.clear()
  lastToastKey.clear()
  sessionFallbackChains.clear()
}
