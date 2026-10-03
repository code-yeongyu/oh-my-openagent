import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import { isSyntheticOrInternalOnlyTextParts } from "../../shared/internal-initiator-marker"
import type { InternalInitiatorTextPartLike } from "../../shared/internal-initiator-marker"
import { classifySessionError } from "./session-error-guard"
import { HOOK_NAME } from "./hook-name"
import { handleAtlasSessionIdle } from "./idle-event"
import { resolveActiveBoulderSession } from "./resolve-active-boulder-session"
import type { AtlasHookOptions, SessionState } from "./types"

function resolveEventTextParts(properties: Record<string, unknown> | undefined): InternalInitiatorTextPartLike[] | undefined {
  const parts = properties?.parts
  if (!Array.isArray(parts)) return undefined
  return parts.filter((part): part is InternalInitiatorTextPartLike =>
    typeof part === "object" && part !== null,
  )
}

export function createAtlasEventHandler(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
  cleanupSession: (sessionID: string) => void
}): (arg: { event: { type: string; properties?: unknown } }) => Promise<void> {
  const { ctx, options, sessions, getState, cleanupSession } = input

  return async ({ event }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = resolveSessionEventID(props)
      if (!sessionID) return

      const classification = classifySessionError(props?.error)

      log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort: classification.isAbort })
      if (classification.isAbort) {
        const activeBoulderSession = await resolveActiveBoulderSession({
          client: ctx.client,
          directory: ctx.directory,
          sessionID,
        })
        if (activeBoulderSession) getState(sessionID).lastEventWasAbortError = true
        return
      }

      if (classification.isTokenLimit || classification.isUnrecoverable) {
        const state = getState(sessionID)
        if (classification.isTokenLimit) {
          state.tokenLimitDetected = true
        } else {
          state.unrecoverableErrorDetected = true
        }
        state.promptFailureCount += 1
        state.lastFailureAt = Date.now()
        state.stalledContinuationReason = classification.isTokenLimit
          ? "Boulder continuation stopped: token limit error detected. Re-injecting would worsen the context overflow."
          : "Boulder continuation stopped: non-retryable API request error detected. The provider rejects the rebuilt request identically on every retry (e.g. a failed compaction with orphaned tool_use)."
        if (state.pendingRetryTimer) {
          clearTimeout(state.pendingRetryTimer)
          state.pendingRetryTimer = undefined
        }
        log(`[${HOOK_NAME}] Stopping boulder continuation after non-retryable session error`, {
          sessionID,
          tokenLimit: classification.isTokenLimit,
          unrecoverableRequest: classification.isUnrecoverable,
          errorName: classification.info?.name,
        })
        return
      }

      const previousInjectedAt = sessions.get(sessionID)?.lastContinuationInjectedAt
      await handleAtlasSessionIdle({ ctx, options, getState, sessionID })
      const state = sessions.get(sessionID)
      if (
        state
        &&
        state.lastContinuationInjectedAt !== undefined
        && state.lastContinuationInjectedAt !== previousInjectedAt
      ) {
        state.skipNextIdleAfterRuntimeErrorRetry = true
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
        if (role === "user" && !isSyntheticOrInternalOnlyTextParts(resolveEventTextParts(props))) {
          state.waitingForFinalWaveApproval = false
          state.tokenLimitDetected = false
          state.unrecoverableErrorDetected = false
          state.stalledContinuationReason = undefined
          state.stalledContinuationPlanPath = undefined
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
        cleanupSession(sessionID)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID })
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        cleanupSession(sessionID)
        log(`[${HOOK_NAME}] Session compacted: cleaned up`, { sessionID })
      }
    }
  }
}
