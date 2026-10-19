import { log } from "../../shared"
import type { PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"

export const DEFAULT_NO_ASSISTANT_OUTPUT_RETRY_DEADLINE_MS = 60_000
export const DEFAULT_NO_ASSISTANT_OUTPUT_RETRY_BASE_DELAY_MS = 1_000
const NO_ASSISTANT_OUTPUT_RETRY_MAX_BACKOFF_MS = 10_000

type ParentWakeWindowRecoveryInput = {
  readonly sessionID: string
  readonly wake: PendingParentWake
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
  readonly requeueWake: (wake: PendingParentWake) => void
  readonly scheduleFlush: (delayMs?: number) => void
  readonly noAssistantOutputRetryDeadlineMs: number
  readonly noAssistantOutputRetryBaseDelayMs: number
}

export function noAssistantOutputRetryBackoffMs(retryCount: number, baseDelayMs: number): number {
  if (retryCount <= 1) {
    return Math.max(0, baseDelayMs)
  }
  return Math.min(baseDelayMs * 2 ** (retryCount - 1), NO_ASSISTANT_OUTPUT_RETRY_MAX_BACKOFF_MS)
}

export async function handleDispatchedParentWakeWindowElapsed(
  input: ParentWakeWindowRecoveryInput,
): Promise<void> {
  const currentWake = input.dispatchedTracker.getWake(input.sessionID)
  if (!currentWake || currentWake.dispatchedAt !== input.wake.dispatchedAt) {
    return
  }

  // The deadline-notice deposit is terminal: the notification text is already
  // in the parent session's chat history, so no further retries are owed.
  if (input.wake.noAssistantOutputDeadlineNotice === true) {
    input.dispatchedTracker.clearWake(input.sessionID)
    log("[background-agent] Completed parent wake cycle after deadline notice deposit:", {
      sessionID: input.sessionID,
    })
    return
  }

  if (await input.sessionInspector.hasAssistantOrToolOutputAfterDispatchedWake(input.sessionID, input.wake)) {
    input.dispatchedTracker.clearWake(input.sessionID)
    log("[background-agent] Cleared dispatched parent wake after observing assistant output:", {
      sessionID: input.sessionID,
    })
    return
  }

  // No assistant output after a dispatch is a failure, not a success to coalesce
  // away: retry with backoff to a bounded deadline.
  const now = Date.now()
  const retryStartedAt = input.wake.noAssistantOutputRetryStartedAt ?? now
  if (now - retryStartedAt >= input.noAssistantOutputRetryDeadlineMs) {
    input.dispatchedTracker.clearWake(input.sessionID)
    input.wake.noAssistantOutputDeadlineNotice = true
    input.requeueWake(input.wake)
    input.scheduleFlush(0)
    log("[background-agent] Deadline exhausted for no-output parent wake; queued visible notice deposit:", {
      sessionID: input.sessionID,
      retryCount: input.wake.noAssistantOutputRetryCount ?? 0,
      deadlineMs: input.noAssistantOutputRetryDeadlineMs,
    })
    return
  }

  const retryCount = (input.wake.noAssistantOutputRetryCount ?? 0) + 1
  const retryDelayMs = noAssistantOutputRetryBackoffMs(retryCount, input.noAssistantOutputRetryBaseDelayMs)
  input.dispatchedTracker.clearWake(input.sessionID)
  input.wake.noAssistantOutputRetryCount = retryCount
  input.wake.noAssistantOutputRetryStartedAt = retryStartedAt
  input.requeueWake(input.wake)
  input.scheduleFlush(retryDelayMs)
  log("[background-agent] Requeued dispatched parent wake after no assistant output:", {
    sessionID: input.sessionID,
    retryCount,
    retryDelayMs,
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
