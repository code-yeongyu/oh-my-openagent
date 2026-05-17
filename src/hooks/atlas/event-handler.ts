import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { HOOK_NAME } from "./hook-name"
import { isAbortError } from "./is-abort-error"
import { handleAtlasSessionIdle } from "./idle-event"
import type { AtlasHookOptions, SessionState } from "./types"

export function createAtlasEventHandler(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
}): (arg: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const { ctx, options, sessions, getState } = input

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
        if (role === "user") {
          state.waitingForFinalWaveApproval = false
        }
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = resolveMessageEventSessionID(props)
      const role = info?.role as string | undefined

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
        }
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
        }
        sessions.delete(sessionID)
        log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
      }
    }
  }
}
