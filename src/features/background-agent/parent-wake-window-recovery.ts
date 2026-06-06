import { log } from "../../shared"
import type { PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import { cloneParentWake } from "./parent-wake-dedupe"

const MAX_PARENT_WAKE_REDISPATCH_ATTEMPTS = 2

type ParentWakeWindowRecoveryInput = {
  readonly sessionID: string
  readonly wake: PendingParentWake
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
  readonly requeueWake: (sessionID: string, wake: PendingParentWake) => void
  readonly scheduleFlush: (sessionID: string, delayMs?: number) => void
  readonly redispatchDelayMs: number
}

export async function handleDispatchedParentWakeWindowElapsed(
  input: ParentWakeWindowRecoveryInput,
): Promise<void> {
  const currentWake = input.dispatchedTracker.getWake(input.sessionID)
  if (!currentWake || currentWake.dispatchedAt !== input.wake.dispatchedAt) {
    return
  }

  if (await input.sessionInspector.hasAssistantOrToolOutputAfterDispatchedWake(input.sessionID, input.wake)) {
    input.dispatchedTracker.clearWake(input.sessionID)
    log("[background-agent] Cleared dispatched parent wake after observing assistant output:", {
      sessionID: input.sessionID,
    })
    return
  }

  const retryCount = currentWake.dispatchRetryCount ?? 0
  if (retryCount >= MAX_PARENT_WAKE_REDISPATCH_ATTEMPTS) {
    input.dispatchedTracker.refreshWakeTimer(input.sessionID)
    log("[background-agent] Exhausted parent wake redispatch attempts; keeping wake tracked for late output:", {
      sessionID: input.sessionID,
      retryCount,
    })
    return
  }

  const retryWake = cloneParentWake(currentWake)
  retryWake.dispatchRetryCount = retryCount + 1
  input.dispatchedTracker.clearWake(input.sessionID)
  input.requeueWake(input.sessionID, retryWake)
  input.scheduleFlush(input.sessionID, input.redispatchDelayMs)
  log("[background-agent] Requeued accepted-but-unprocessed parent wake for redispatch:", {
    sessionID: input.sessionID,
    attempt: retryCount + 1,
  })
}

export function logParentWakeWindowRecoveryError(sessionID: string, error: unknown): void {
  const errorText = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  log("[background-agent] Failed to inspect dispatched parent wake after recovery window:", {
    sessionID,
    error: errorText,
  })
}

export function rescheduleParentWakeWindowRecoveryAfterError(
  sessionID: string,
  wake: PendingParentWake,
  dispatchedTracker: ParentWakeDispatchedTracker,
): void {
  const currentWake = dispatchedTracker.getWake(sessionID)
  if (!currentWake || currentWake.dispatchedAt !== wake.dispatchedAt) {
    return
  }
  dispatchedTracker.refreshWakeTimer(sessionID)
}
