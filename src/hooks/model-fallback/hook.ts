import type { FallbackEntry } from "../../shared/model-requirements"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { readConnectedProvidersCache, readProviderModelsCache } from "../../shared/connected-providers-cache"
import { selectFallbackProvider } from "../../shared/model-error-classifier"
import { log } from "../../shared/logger"
import { getTaskToastManager } from "../../features/task-toast-manager"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"

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
  if (!requirements || !requirements.fallbackChain || requirements.fallbackChain.length === 0) {
    log("[model-fallback] No fallback chain for agent: " + agentName + " (key: " + agentKey + ")")
    return false
  }

  const fallbackChain = requirements.fallbackChain
  const existing = pendingModelFallbacks.get(sessionID)

  if (existing) {
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

  const { fallbackChain } = state

  const providerModelsCache = readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders) : null

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true

    // Gate only on provider connectivity. Provider model lists can be stale/incomplete,
    // especially after users manually add models to opencode.json.
    return entry.providers.some((p) => connectedSet.has(p))
  }

  while (state.attemptCount < fallbackChain.length) {
    const attemptCount = state.attemptCount
    const fallback = fallbackChain[attemptCount]
    state.attemptCount++

    if (!isReachable(fallback)) {
      log("[model-fallback] Skipping unreachable fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)
      continue
    }

    const providerID = selectFallbackProvider(fallback.providers, state.providerID)
    state.pending = false

    log("[model-fallback] Using fallback for session: " + sessionID + ", attempt: " + attemptCount + ", model: " + fallback.model)

    return {
      providerID,
      modelID: fallback.model,
      variant: fallback.variant,
    }
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

      output.message["model"] = {
        providerID: fallback.providerID,
        modelID: fallback.modelID,
      }
      if (fallback.variant !== undefined) {
        output.message["variant"] = fallback.variant
      } else {
        delete output.message["variant"]
      }
      if (toast) {
        const key = `${sessionID}:${fallback.providerID}/${fallback.modelID}:${fallback.variant ?? ""}`
        if (lastToastKey.get(sessionID) !== key) {
          lastToastKey.set(sessionID, key)
          const variantLabel = fallback.variant ? ` (${fallback.variant})` : ""
          await Promise.resolve(
            toast({
              title: "Model fallback",
              message: `Using ${fallback.providerID}/${fallback.modelID}${variantLabel}`,
              variant: "warning",
              duration: 5000,
            }),
          )
        }
      }
      if (onApplied) {
        await Promise.resolve(
          onApplied({
            sessionID,
            providerID: fallback.providerID,
            modelID: fallback.modelID,
            variant: fallback.variant,
          }),
        )
      }

      const toastManager = getTaskToastManager()
      if (toastManager) {
        const variantLabel = fallback.variant ? ` (${fallback.variant})` : ""
        toastManager.updateTaskModelBySession(sessionID, {
          model: `${fallback.providerID}/${fallback.modelID}${variantLabel}`,
          type: "runtime-fallback",
        })
      }
      log("[model-fallback] Applied fallback model: " + JSON.stringify(fallback))
    },
  }
}
