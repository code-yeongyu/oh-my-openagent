import { log } from "../../shared/logger"

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
    const sessionID = info?.sessionID as string | undefined
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
      if (state) state.abortDetectedAt = undefined
      sessionStateStore.cancelCountdown(sessionID)
      return
    }

    if (role === "assistant") {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) state.abortDetectedAt = undefined
      sessionStateStore.cancelCountdown(sessionID)
      return
    }

    return
  }

  if (eventType === "message.part.updated") {
    const info = properties?.info as Record<string, unknown> | undefined
    const sessionID = info?.sessionID as string | undefined
    const role = info?.role as string | undefined

    if (sessionID && role === "assistant") {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) state.abortDetectedAt = undefined
      sessionStateStore.cancelCountdown(sessionID)
    }
    return
  }

  if (eventType === "tool.execute.before" || eventType === "tool.execute.after") {
    const sessionID = properties?.sessionID as string | undefined
    if (sessionID) {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) state.abortDetectedAt = undefined
      sessionStateStore.cancelCountdown(sessionID)
    }
    return
  }

  if (eventType === "session.deleted") {
    const sessionInfo = properties?.info as { id?: string } | undefined
    if (sessionInfo?.id) {
      sessionStateStore.cleanup(sessionInfo.id)
      log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
    }
    return
  }
}
