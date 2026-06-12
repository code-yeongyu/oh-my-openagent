import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import type { InternalInitiatorTextPartLike } from "../../shared/internal-initiator-marker"
import { isSyntheticOrInternalOnlyTextParts } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { isSystemDirective } from "../../shared/system-directive"

import { COUNTDOWN_GRACE_PERIOD_MS, HOOK_NAME } from "./constants"
import type { SessionStateStore } from "./session-state"

function isEventPart(value: unknown): value is InternalInitiatorTextPartLike {
  if (typeof value !== "object" || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const type = record.type
  const text = record.text
  const synthetic = record.synthetic

  return (
    (type === undefined || typeof type === "string") &&
    (text === undefined || typeof text === "string") &&
    (synthetic === undefined || typeof synthetic === "boolean")
  )
}

function resolveEventParts(
  properties: Record<string, unknown> | undefined
): InternalInitiatorTextPartLike[] | undefined {
  const parts = properties?.parts
  if (!Array.isArray(parts) || !parts.every(isEventPart)) {
    return undefined
  }

  return parts
}

function hasInternalSystemDirective(parts: InternalInitiatorTextPartLike[] | undefined): boolean {
  return (parts ?? []).some(
    (part) => part.type === "text"
      && typeof part.text === "string"
      && isSystemDirective(part.text),
  )
}

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
      const parts = resolveEventParts(properties)
      if (isSyntheticOrInternalOnlyTextParts(parts)) {
        const state = sessionStateStore.getExistingState(sessionID)
        if (state?.countdownStartedAt && hasInternalSystemDirective(parts)) {
          sessionStateStore.cancelCountdown(sessionID)
          log(`[${HOOK_NAME}] Cancelled countdown for internal continuation message`, { sessionID })
        }
        log(`[${HOOK_NAME}] Ignoring synthetic/internal user message event`, { sessionID })
        return
      }
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
      }
      sessionStateStore.cancelCountdown(sessionID)
      return
    }

    if (role === "assistant") {
      const state = sessionStateStore.getExistingState(sessionID)
      if (state) {
        state.abortDetectedAt = undefined
        state.wasCancelled = false
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
