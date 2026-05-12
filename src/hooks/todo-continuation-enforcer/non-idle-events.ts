import { log } from "../../shared/logger"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"

import { COUNTDOWN_GRACE_PERIOD_MS, HOOK_NAME } from "./constants"
import type { SessionStateStore } from "./session-state"

export function handleNonIdleEvent(args: {
  eventType: string
  properties: Record<string, unknown> | undefined
  sessionStateStore: SessionStateStore
}): void {
  const { eventType, properties, sessionStateStore } = args

  if (eventType === "message.updated") {
    const info = properties?.info as Record<string, unknown> | undefined
    const sessionID = resolveMessageEventSessionID(properties)
    const role = info?.role as string | undefined
    if (!sessionID) return

    if (role === "user") {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state?.countdownStartedAt) {
        const elapsed = Date.now() - state.countdownStartedAt
        if (elapsed < COUNTDOWN_GRACE_PERIOD_MS) {
          log(`[${HOOK_NAME}] Ignoring user message in grace period`, { sessionID, elapsed })
          return
        }
      }
      if (state) {
        state.abortDetectedAt = undefined
        state.wasCancelled = false
        state.tokenLimitDetected = false
        sessionStateStore.recordActivity(sessionID)
      }
      sessionStateStore.cancelCountdown(sessionID)
      return
    }

    if (role === "assistant") {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) {
        state.abortDetectedAt = undefined
        state.wasCancelled = false
        sessionStateStore.recordActivity(sessionID)
      }
      sessionStateStore.cancelCountdown(sessionID)
      return
    }

    return
  }

  if (eventType === "message.part.updated") {
    const targetSessionID = resolveMessageEventSessionID(properties)

    if (targetSessionID) {
      const state = sessionStateStore.getExistingState(targetSessionID)
      if (state) {
        state.abortDetectedAt = undefined
        sessionStateStore.recordActivity(targetSessionID)
      }
      sessionStateStore.cancelCountdown(targetSessionID)
    }
    return
  }

  if (eventType === "message.part.delta") {
    const sessionID = resolveMessageEventSessionID(properties)
    if (sessionID) {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) {
        state.abortDetectedAt = undefined
        state.wasCancelled = false
        sessionStateStore.recordActivity(sessionID)
      }
      sessionStateStore.cancelCountdown(sessionID)
    }
    return
  }

  if (eventType === "tool.execute.before" || eventType === "tool.execute.after") {
    const sessionID = resolveMessageEventSessionID(properties)
    if (sessionID) {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) {
        state.abortDetectedAt = undefined
        state.wasCancelled = false
        sessionStateStore.recordActivity(sessionID)
      }
      sessionStateStore.cancelCountdown(sessionID)
    }
    return
  }

  if (eventType === "session.deleted") {
    const sessionID = resolveSessionEventID(properties)
    if (sessionID) {
      sessionStateStore.cleanup(sessionID)
      log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID })
    }
    return
  }
}
