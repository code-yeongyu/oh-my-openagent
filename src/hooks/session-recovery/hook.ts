import type { PluginInput } from "@opencode-ai/plugin"
import { detectErrorType } from "./detect-error-type"
import { createSessionErrorRecoveryHandler } from "./error-recovery"
import { createInterruptedToolResultsHandler } from "./interrupted-tool-results"
import type { SessionRecoveryCallbacks, SessionRecoveryHook, SessionRecoveryOptions } from "./hook-types"

export type { MessageInfo, SessionRecoveryHook, SessionRecoveryOptions } from "./hook-types"

export function createSessionRecoveryHook(ctx: PluginInput, options?: SessionRecoveryOptions): SessionRecoveryHook {
  const callbacks: SessionRecoveryCallbacks = {
    onAbortCallback: null,
    onRecoveryCompleteCallback: null,
  }

  const setOnAbortCallback = (callback: (sessionID: string) => void): void => {
    callbacks.onAbortCallback = callback
  }

  const setOnRecoveryCompleteCallback = (callback: (sessionID: string) => void): void => {
    callbacks.onRecoveryCompleteCallback = callback
  }

  const isRecoverableError = (error: unknown): boolean => {
    return detectErrorType(error) !== null
  }

  const handleSessionRecovery = createSessionErrorRecoveryHandler(ctx, callbacks, options?.experimental)
  const handleInterruptedToolResultsOnIdle = createInterruptedToolResultsHandler(ctx, callbacks)

  return {
    handleSessionRecovery,
    handleInterruptedToolResultsOnIdle,
    isRecoverableError,
    setOnAbortCallback,
    setOnRecoveryCompleteCallback,
  }
}
