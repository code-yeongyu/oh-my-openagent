import type { FallbackEntry } from "../../shared/model-requirements"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"
import {
  createModelFallbackStateController,
  type ModelFallbackStateController,
} from "./fallback-state-controller"
import type { ModelFallbackControllerAccessor } from "./controller-accessor"

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

type ModelFallbackControllerWithState = Pick<
  ModelFallbackStateController,
  | "lastToastKey"
  | "setSessionFallbackChain"
  | "clearSessionFallbackChain"
  | "setPendingModelFallback"
  | "getNextFallback"
  | "clearPendingModelFallback"
  | "hasPendingModelFallback"
  | "getFallbackState"
  | "reset"
>

export type ModelFallbackHook = ModelFallbackControllerWithState & {
  "chat.message": (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput,
  ) => Promise<void>
}

type ModelFallbackHookArgs = {
  toast?: FallbackToast
  onApplied?: FallbackCallback
  controllerAccessor?: ModelFallbackControllerAccessor
}

export function setSessionFallbackChain(
  controller: Pick<ModelFallbackStateController, "setSessionFallbackChain">,
  sessionID: string,
  fallbackChain: FallbackEntry[] | undefined,
): void {
  controller.setSessionFallbackChain(sessionID, fallbackChain)
}

export function clearSessionFallbackChain(
  controller: Pick<ModelFallbackStateController, "clearSessionFallbackChain">,
  sessionID: string,
): void {
  controller.clearSessionFallbackChain(sessionID)
}

/**
 * Sets a pending model fallback for a session.
 * Called when a model error is detected in session.error handler.
 */
export function setPendingModelFallback(
  controller: Pick<ModelFallbackStateController, "setPendingModelFallback">,
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  currentModelID: string,
): boolean {
  return controller.setPendingModelFallback(
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
  controller: Pick<ModelFallbackStateController, "getNextFallback">,
  sessionID: string,
): { providerID: string; modelID: string; variant?: string } | null {
  return controller.getNextFallback(sessionID)
}

/**
 * Clears the pending fallback for a session.
 * Called after fallback is successfully applied.
 */
export function clearPendingModelFallback(
  controller: Pick<ModelFallbackStateController, "clearPendingModelFallback">,
  sessionID: string,
): void {
  controller.clearPendingModelFallback(sessionID)
}

/**
 * Checks if there's a pending fallback for a session.
 */
export function hasPendingModelFallback(
  controller: Pick<ModelFallbackStateController, "hasPendingModelFallback">,
  sessionID: string,
): boolean {
  return controller.hasPendingModelFallback(sessionID)
}

/**
 * Gets the current fallback state for a session (for debugging).
 */
export function getFallbackState(
  controller: Pick<ModelFallbackStateController, "getFallbackState">,
  sessionID: string,
): ModelFallbackState | undefined {
  return controller.getFallbackState(sessionID)
}

/**
 * Creates a chat.message hook that applies model fallbacks when pending.
 */
export function createModelFallbackHook(args?: ModelFallbackHookArgs): ModelFallbackHook {
  const pendingModelFallbacks = new Map<string, ModelFallbackState>()
  const lastToastKey = new Map<string, string>()
  const sessionFallbackChains = new Map<string, FallbackEntry[]>()
  const controller = createModelFallbackStateController({
    pendingModelFallbacks,
    lastToastKey,
    sessionFallbackChains,
  })

  args?.controllerAccessor?.register(controller)

  const toast = args?.toast
  const onApplied = args?.onApplied

  return {
    lastToastKey: controller.lastToastKey,
    setSessionFallbackChain: controller.setSessionFallbackChain,
    clearSessionFallbackChain: controller.clearSessionFallbackChain,
    setPendingModelFallback: controller.setPendingModelFallback,
    getNextFallback: controller.getNextFallback,
    clearPendingModelFallback: controller.clearPendingModelFallback,
    hasPendingModelFallback: controller.hasPendingModelFallback,
    getFallbackState: controller.getFallbackState,
    reset: controller.reset,
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageHandlerOutput,
    ): Promise<void> => {
      const { sessionID } = input
      if (!sessionID) return

      const fallback = getNextFallback(controller, sessionID)
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
 * Resets hook-owned state for testing.
 */
export function _resetForTesting(controller?: Pick<ModelFallbackStateController, "reset">): void {
  controller?.reset()
}
