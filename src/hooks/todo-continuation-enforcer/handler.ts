import type { PluginInput } from "@opencode-ai/plugin"

import type { BackgroundManager } from "../../features/background-agent"
import {
  clearContinuationMarker,
} from "../../features/run-continuation-state"
import { isRetryableModelError } from "../../shared/model-error-classifier"
import { log } from "../../shared/logger"

import {
  DEFAULT_SKIP_AGENTS,
  HOOK_NAME,
  TOKEN_LIMIT_COOLDOWN_MS,
} from "./constants"
import type { SessionStateStore } from "./session-state"
import { handleSessionIdle } from "./idle-event"
import { handleNonIdleEvent } from "./non-idle-events"

interface SessionErrorEvent {
  name?: string
  message?: string
  data?: {
    message?: string
  }
}

function isTokenLimitOrOverloadedError(error: SessionErrorEvent | string | undefined): boolean {
  if (!error) {
    return false
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("prompt is too long")
      || lower.includes("context length")
      || lower.includes("context_length")
      || lower.includes("overloaded")
  }

  const errorMessage = [error.message, error.data?.message]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase()

  if (error.name === "ContextLengthError") {
    return true
  }

  const hasOverloadedSignal = errorMessage.includes("overloaded")
  return hasOverloadedSignal && isRetryableModelError({ name: error.name, message: errorMessage })
}

export function createTodoContinuationHandler(args: {
  ctx: PluginInput
  sessionStateStore: SessionStateStore
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
  isContinuationStopped?: (sessionID: string) => boolean
  shouldSkipContinuation?: (sessionID: string) => boolean
}): (input: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const {
    ctx,
    sessionStateStore,
    backgroundManager,
    skipAgents = DEFAULT_SKIP_AGENTS,
    isContinuationStopped,
    shouldSkipContinuation,
  } = args

  return async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const error = props?.error as SessionErrorEvent | undefined
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = sessionStateStore.getState(sessionID)
        state.abortDetectedAt = Date.now()
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      }

      if (isTokenLimitOrOverloadedError(error)) {
        const state = sessionStateStore.getState(sessionID)
        state.cooldownUntil = Date.now() + TOKEN_LIMIT_COOLDOWN_MS
        log(`[${HOOK_NAME}] Extended cooldown set for token-limit/overloaded error`, {
          sessionID,
          errorName: error?.name,
          cooldownMs: TOKEN_LIMIT_COOLDOWN_MS,
        })
      }

      sessionStateStore.cancelCountdown(sessionID)
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      await handleSessionIdle({
        ctx,
        sessionID,
        sessionStateStore,
        backgroundManager,
        skipAgents,
        isContinuationStopped,
        shouldSkipContinuation,
      })
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        clearContinuationMarker(ctx.directory, sessionInfo.id)
      }
    }

    handleNonIdleEvent({
      eventType: event.type,
      properties: props,
      sessionStateStore,
    })
  }
}
