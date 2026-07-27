import type { PluginInput } from "@opencode-ai/plugin"
import { clearBoulderPause, isBoulderPausedForSession } from "../../features/boulder-state"
import {
  hasInternalInitiatorMarker,
  isRealUserTextPart,
  isTextPartLike,
  type InternalInitiatorTextPartLike,
} from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { HOOK_NAME } from "./hook-name"
import { isAbortError } from "./is-abort-error"
import { handleAtlasSessionIdle } from "./idle-event"
import {
  consumePendingMessage,
  hasPendingMessage,
  type PendingMessageCorrelation,
  rememberPendingMessage,
} from "./pending-message-correlation"
import type { AtlasHookOptions, SessionState } from "./types"

function isEventPart(value: unknown): value is InternalInitiatorTextPartLike {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    (record.type === undefined || typeof record.type === "string")
    && (record.text === undefined || typeof record.text === "string")
    && (record.synthetic === undefined || typeof record.synthetic === "boolean")
  )
}

function resolveEventParts(
  properties: Record<string, unknown> | undefined,
): InternalInitiatorTextPartLike[] | undefined {
  const parts = properties?.parts
  return Array.isArray(parts) && parts.every(isEventPart) ? parts : undefined
}

function resolveUpdatedPart(
  properties: Record<string, unknown> | undefined,
): (InternalInitiatorTextPartLike & { readonly messageID?: string }) | undefined {
  const part = properties?.part
  if (!isEventPart(part)) {
    return undefined
  }

  const messageID = (part as Record<string, unknown>).messageID
  if (messageID !== undefined && typeof messageID !== "string") {
    return undefined
  }

  return { ...part, ...(messageID ? { messageID } : {}) }
}

export function createAtlasEventHandler(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
}): (arg: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const { ctx, options, sessions, getState } = input
  const pendingUserMessages: PendingMessageCorrelation = new Map()

  function clearFinalWaveApproval(sessionID: string, state: SessionState | undefined): void {
    if (state) {
      state.waitingForFinalWaveApproval = false
    }
    clearBoulderPause(ctx.directory, {
      reason: "final_wave_approval",
      sessionId: sessionID,
    })
  }

  return async ({ event }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID) return

      const state = getState(sessionID)
      const isAbort = isAbortError(props?.error)
      state.lastEventWasAbortError = isAbort

      log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort })
      if (!isAbort) {
        const previousInjectedAt = state.lastContinuationInjectedAt
        await handleAtlasSessionIdle({ ctx, options, getState, sessionID })
        if (
          state.lastContinuationInjectedAt !== undefined
          && state.lastContinuationInjectedAt !== previousInjectedAt
        ) {
          state.skipNextIdleAfterRuntimeErrorRetry = true
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID) return
      await handleAtlasSessionIdle({ ctx, options, getState, sessionID })
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = resolveMessageEventSessionID(props)
      const role = info?.role as string | undefined
      if (!sessionID) return

      const state = sessions.get(sessionID)
      if (state) {
        state.lastEventWasAbortError = false
        state.skipNextIdleAfterRuntimeErrorRetry = false
      }
      if (role === "user") {
        const isAwaitingApproval = state?.waitingForFinalWaveApproval === true
          || isBoulderPausedForSession(ctx.directory, {
            reason: "final_wave_approval",
            sessionId: sessionID,
          })
        if (!isAwaitingApproval) {
          pendingUserMessages.delete(sessionID)
          return
        }

        const parts = resolveEventParts(props)
        const messageID = typeof info?.id === "string" ? info.id : undefined
        if (parts === undefined) {
          if (messageID) {
            rememberPendingMessage(pendingUserMessages, sessionID, messageID)
          }
          return
        }

        if (messageID) {
          consumePendingMessage(pendingUserMessages, sessionID, messageID)
        }
        if (!parts.some(isRealUserTextPart)) {
          return
        }

        pendingUserMessages.delete(sessionID)
        clearFinalWaveApproval(sessionID, state)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = resolveMessageEventSessionID(props)
      const role = info?.role as string | undefined

      const part = resolveUpdatedPart(props)
      const messageID = part?.messageID
      if (
        sessionID
        && part
        && messageID
        && hasPendingMessage(pendingUserMessages, sessionID, messageID)
      ) {
        if (isTextPartLike(part) && hasInternalInitiatorMarker(part.text)) {
          consumePendingMessage(pendingUserMessages, sessionID, messageID)
          return
        }
        if (!isRealUserTextPart(part)) return

        consumePendingMessage(pendingUserMessages, sessionID, messageID)
        pendingUserMessages.delete(sessionID)
        clearFinalWaveApproval(sessionID, sessions.get(sessionID))
        return
      }

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
          state.skipNextIdleAfterRuntimeErrorRetry = false
        }
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = resolveMessageEventSessionID(props)
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
          state.skipNextIdleAfterRuntimeErrorRetry = false
        }
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        const deletedState = sessions.get(sessionID)
        if (deletedState?.pendingRetryTimer) {
          clearTimeout(deletedState.pendingRetryTimer)
          deletedState.pendingRetryTimer = undefined
        }
        pendingUserMessages.delete(sessionID)
        sessions.delete(sessionID)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID })
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        const compactedState = sessions.get(sessionID)
        if (compactedState?.pendingRetryTimer) {
          clearTimeout(compactedState.pendingRetryTimer)
          compactedState.pendingRetryTimer = undefined
        }
        pendingUserMessages.delete(sessionID)
        sessions.delete(sessionID)
        log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
      }
    }
  }
}
