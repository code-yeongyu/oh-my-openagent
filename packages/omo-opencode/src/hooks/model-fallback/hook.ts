import type { FallbackEntry } from "../../shared/model-requirements"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { getRuntimeFallbackModelIdentity } from "@oh-my-opencode/model-core"
import {
  clearSessionPromptParams,
  getSessionPromptParams,
  setSessionPromptParams,
  type SessionPromptParams,
} from "../../shared"
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
  | "getSessionFallbackChain"
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

export function getSessionFallbackChain(
  controller: Pick<ModelFallbackStateController, "getSessionFallbackChain">,
  sessionID: string,
): FallbackEntry[] | undefined {
  return controller.getSessionFallbackChain(sessionID)
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
  const promptParamsBeforeFallback = new Map<string, SessionPromptParams | undefined>()
  const appliedFallbacks = new Map<string, {
    model: string
    originalModel: string
    variant?: string
  }>()
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
    getSessionFallbackChain: controller.getSessionFallbackChain,
    clearSessionFallbackChain: controller.clearSessionFallbackChain,
    setPendingModelFallback: controller.setPendingModelFallback,
    getNextFallback: controller.getNextFallback,
    clearPendingModelFallback: (sessionID) => {
      controller.clearPendingModelFallback(sessionID)
      promptParamsBeforeFallback.delete(sessionID)
      appliedFallbacks.delete(sessionID)
    },
    hasPendingModelFallback: controller.hasPendingModelFallback,
    getFallbackState: controller.getFallbackState,
    reset: () => {
      controller.reset()
      promptParamsBeforeFallback.clear()
      appliedFallbacks.clear()
    },
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageHandlerOutput,
    ): Promise<void> => {
      const { sessionID } = input
      if (!sessionID) return

      const appliedFallback = appliedFallbacks.get(sessionID)
      const requestedModel = input.model
        ? getRuntimeFallbackModelIdentity(`${input.model.providerID}/${input.model.modelID}`)
        : undefined
      const requestedVariant = typeof output.message["variant"] === "string"
        ? output.message["variant"]
        : undefined
      const changedVariant = appliedFallback !== undefined
        && requestedModel === appliedFallback.model
        && requestedVariant !== appliedFallback.variant
      if (
        appliedFallback
        && !controller.hasPendingModelFallback(sessionID)
        && requestedModel
        && (requestedModel !== appliedFallback.model || changedVariant)
      ) {
        const original = promptParamsBeforeFallback.get(sessionID)
        if (requestedModel === appliedFallback.originalModel && !changedVariant && original) {
          setSessionPromptParams(sessionID, original)
        } else {
          clearSessionPromptParams(sessionID)
        }
        promptParamsBeforeFallback.delete(sessionID)
        appliedFallbacks.delete(sessionID)
      }

      const fallbackState = controller.getFallbackState(sessionID)
      const fallback = getNextFallback(controller, sessionID)
      if (!fallback) return

      if (!promptParamsBeforeFallback.has(sessionID)) {
        promptParamsBeforeFallback.set(sessionID, getSessionPromptParams(sessionID))
      }
      const originalModel = appliedFallback?.originalModel ?? (fallbackState
        ? getRuntimeFallbackModelIdentity(`${fallbackState.providerID}/${fallbackState.modelID}`)
        : getRuntimeFallbackModelIdentity(`${fallback.providerID}/${fallback.modelID}`))

      await applyFallbackToChatMessage({
        input,
        output,
        fallback,
        toast,
        onApplied,
        lastToastKey: controller.lastToastKey,
      })
      appliedFallbacks.set(sessionID, {
        model: getRuntimeFallbackModelIdentity(`${fallback.providerID}/${fallback.modelID}`),
        originalModel,
        variant: getSessionPromptParams(sessionID)?.variant,
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
