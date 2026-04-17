import type { FallbackEntry } from "../../shared/model-requirements"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"
import {
  createModelFallbackStateController,
  type ModelFallbackStateController,
} from "./fallback-state-controller"

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

const modelFallbackControllerRef: { current?: ModelFallbackStateController } = {}

function getOrCreateModelFallbackController(): ModelFallbackStateController {
  if (!modelFallbackControllerRef.current) {
    createModelFallbackHook()
  }

  const controller = modelFallbackControllerRef.current
  if (!controller) {
    throw new Error("Model fallback controller should be initialized")
  }
  return controller
}

export function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void {
  getOrCreateModelFallbackController().setSessionFallbackChain(sessionID, fallbackChain)
}

export function clearSessionFallbackChain(sessionID: string): void {
  getOrCreateModelFallbackController().clearSessionFallbackChain(sessionID)
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
  return getOrCreateModelFallbackController().setPendingModelFallback(
    sessionID,
    agentName,
    currentProviderID,
    currentModelID,
  )
}

/**
 * Gets the next fallback model for a session.
 * Increments attemptCount each time called.
 */
export function getNextFallback(
  sessionID: string,
): { providerID: string; modelID: string; variant?: string } | null {
  return getOrCreateModelFallbackController().getNextFallback(sessionID)
}

/**
 * Clears the pending fallback for a session.
 * Called after fallback is successfully applied.
 */
export function clearPendingModelFallback(sessionID: string): void {
  getOrCreateModelFallbackController().clearPendingModelFallback(sessionID)
}

/**
 * Checks if there's a pending fallback for a session.
 */
export function hasPendingModelFallback(sessionID: string): boolean {
  return getOrCreateModelFallbackController().hasPendingModelFallback(sessionID)
}

/**
 * Gets the current fallback state for a session (for debugging).
 */
export function getFallbackState(sessionID: string): ModelFallbackState | undefined {
  return getOrCreateModelFallbackController().getFallbackState(sessionID)
}

/**
 * Creates a chat.message hook that applies model fallbacks when pending.
 */
export function createModelFallbackHook(args?: { toast?: FallbackToast; onApplied?: FallbackCallback }) {
  if (!modelFallbackControllerRef.current) {
    const pendingModelFallbacks = new Map<string, ModelFallbackState>()
    const lastToastKey = new Map<string, string>()
    const sessionFallbackChains = new Map<string, FallbackEntry[]>()

    modelFallbackControllerRef.current = createModelFallbackStateController({
      pendingModelFallbacks,
      lastToastKey,
      sessionFallbackChains,
    })
  }

  const controller = getOrCreateModelFallbackController()
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
        lastToastKey: controller.lastToastKey,
      })
    },
  }
}

/**
 * Resets all module-global state for testing.
 * Clears pending fallbacks, toast keys, and session chains.
 */
export function _resetForTesting(): void {
  getOrCreateModelFallbackController().reset()
}
