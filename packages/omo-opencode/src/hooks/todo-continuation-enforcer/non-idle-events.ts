import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"
import type { InternalInitiatorTextPartLike } from "../../shared/internal-initiator-marker"
import { isSyntheticOrInternalOnlyTextParts } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { isSystemDirective } from "../../shared/system-directive"

import { COUNTDOWN_GRACE_PERIOD_MS, HOOK_NAME } from "./constants"
import type { SessionStateStore } from "./session-state"
import type { SessionState } from "./types"

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

function hasAcceptedContinuationLifecycle(state: SessionState): boolean {
  return state.awaitingPostInjectionProgressCheck === true
    || state.continuationResponseObserved === true
    || state.continuationBlockReason === "directive-response"
}

function markContinuationResponseObserved(state: SessionState | undefined): void {
  if (state?.awaitingPostInjectionProgressCheck === true) {
    state.continuationResponseObserved = true
  }
}

function pauseForGenuineUserInterruption(args: {
  state: SessionState
  sessionID: string
  sessionStateStore: SessionStateStore
}): void {
  const { state, sessionID, sessionStateStore } = args
  state.continuationBlockReason = "user-interruption"
  state.continuationResponseObserved = false
  state.pendingUserMessageID = undefined
  state.abortDetectedAt = undefined
  state.wasCancelled = false
  state.tokenLimitDetected = false
  sessionStateStore.cancelCountdown(sessionID)
  log(`[${HOOK_NAME}] Paused continuation after genuine user interruption`, { sessionID })
}

function resolveUpdatedPart(
  properties: Record<string, unknown> | undefined,
): (InternalInitiatorTextPartLike & { messageID?: string }) | undefined {
  const part = properties?.part
  if (!isEventPart(part)) {
    return undefined
  }

  const messageID = (part as Record<string, unknown>).messageID
  if (messageID !== undefined && typeof messageID !== "string") {
    return undefined
  }

  return {
    ...part,
    ...(messageID ? { messageID } : {}),
  }
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
      const messageID = typeof info?.id === "string" ? info.id : undefined
      if (parts === undefined && state && hasAcceptedContinuationLifecycle(state) && messageID) {
        state.pendingUserMessageID = messageID
        log(`[${HOOK_NAME}] Deferred user interruption classification until message part`, {
          sessionID,
          messageID,
        })
        return
      }
      if (state && hasAcceptedContinuationLifecycle(state)) {
        pauseForGenuineUserInterruption({ state, sessionID, sessionStateStore })
        return
      }
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
        markContinuationResponseObserved(state)
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
        const part = resolveUpdatedPart(properties)
        if (part?.messageID && part.messageID === state.pendingUserMessageID) {
          state.pendingUserMessageID = undefined
          if (isSyntheticOrInternalOnlyTextParts([part])) {
            log(`[${HOOK_NAME}] Ignoring synthetic/internal split user message`, {
              sessionID: targetSessionID,
              messageID: part.messageID,
            })
          } else if (hasAcceptedContinuationLifecycle(state)) {
            pauseForGenuineUserInterruption({
              state,
              sessionID: targetSessionID,
              sessionStateStore,
            })
          }
          return
        }
        const info = properties?.info as Record<string, unknown> | undefined
        if (info?.role === "assistant") {
          markContinuationResponseObserved(state)
        }
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
        const info = properties?.info as Record<string, unknown> | undefined
        if (info?.role === "assistant") {
          markContinuationResponseObserved(state)
        }
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
        markContinuationResponseObserved(state)
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
