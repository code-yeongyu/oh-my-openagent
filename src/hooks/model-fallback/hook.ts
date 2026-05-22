import type { FallbackEntry } from "@oh-my-opencode/model-core"
import type { ModelFallbackState } from "@oh-my-opencode/fallback-state-core"
import type { ChatMessageInput, ChatMessageHandlerOutput } from "../../plugin/chat-message"
import { applyFallbackToChatMessage } from "./chat-message-fallback-handler"
import {
  createModelFallbackStateController,
  type ModelFallbackStateController,
} from "./fallback-state-controller"
import type { ModelFallbackControllerAccessor } from "./controller-accessor"
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

export type { ModelFallbackState }

type ModelFallbackControllerWithState = Pick<
  ModelFallbackStateController,
  | "lastToastKey"
  | "setSessionFallbackChain"
  | "getSessionFallbackChain"
  | "clearSessionFallbackChain"
  | "setPendingModelFallback"
  | "clearPendingModelFallback"
  | "hasPendingModelFallback"
  | "getFallbackState"
  | "reset"
>

export type ModelFallbackHook = ModelFallbackControllerWithState & {
  getNextFallback: (sessionID: string) => ReturnType<typeof getNextReachableFallback>
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

export function getNextFallback(
  controller: Pick<ModelFallbackStateController, "getFallbackState" | "clearPendingModelFallback">,
  sessionID: string,
): ReturnType<typeof getNextReachableFallback> {
  const state = controller.getFallbackState(sessionID)
  if (!state?.pending) return null
  const result = getNextReachableFallback(sessionID, state)
  controller.clearPendingModelFallback(sessionID)
  return result
}

export function clearPendingModelFallback(
  controller: Pick<ModelFallbackStateController, "clearPendingModelFallback">,
  sessionID: string,
): void {
  controller.clearPendingModelFallback(sessionID)
}

export function hasPendingModelFallback(
  controller: Pick<ModelFallbackStateController, "hasPendingModelFallback">,
  sessionID: string,
): boolean {
  return controller.hasPendingModelFallback(sessionID)
}

export function getFallbackState(
  controller: Pick<ModelFallbackStateController, "getFallbackState">,
  sessionID: string,
): ModelFallbackState | undefined {
  return controller.getFallbackState(sessionID)
}

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
    getSessionFallbackChain: controller.getSessionFallbackChain,
    clearSessionFallbackChain: controller.clearSessionFallbackChain,
    setPendingModelFallback: controller.setPendingModelFallback,
    getNextFallback: (sessionID: string) => getNextFallback(controller, sessionID),
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

export function _resetForTesting(controller?: Pick<ModelFallbackStateController, "reset">): void {
  controller?.reset()
}
