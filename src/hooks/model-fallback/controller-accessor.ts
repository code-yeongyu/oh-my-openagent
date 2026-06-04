import type { FallbackEntry } from "../../shared/model-requirements"
import type { ModelFallbackStateController } from "./fallback-state-controller"

export type ModelFallbackControllerAccessor = {
  register: (controller: ModelFallbackStateController) => void
  setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void
  getSessionFallbackChain: (sessionID: string) => FallbackEntry[] | undefined
  clearSessionFallbackChain: (sessionID: string) => void
}

export function createModelFallbackControllerAccessor(): ModelFallbackControllerAccessor {
  let controller: ModelFallbackStateController | null = null

  function register(nextController: ModelFallbackStateController): void {
    controller = nextController
  }

  function setSessionFallbackChain(sessionID: string, fallbackChain: FallbackEntry[] | undefined): void {
    controller?.setSessionFallbackChain(sessionID, fallbackChain)
  }

  function getSessionFallbackChain(sessionID: string): FallbackEntry[] | undefined {
    return controller?.getSessionFallbackChain(sessionID)
  }

  function clearSessionFallbackChain(sessionID: string): void {
    controller?.clearSessionFallbackChain(sessionID)
  }

  return {
    register,
    setSessionFallbackChain,
    getSessionFallbackChain,
    clearSessionFallbackChain,
  }
}
