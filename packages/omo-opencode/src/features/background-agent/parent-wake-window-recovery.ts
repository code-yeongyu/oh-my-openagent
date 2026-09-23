import { log } from "../../shared"
import type { PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"

const MAX_NO_ASSISTANT_OUTPUT_RETRIES = 1
/**
 * Ceiling on how many times the self-scheduling recovery trigger may fire for
 * the same wake generation before it stops retrying. Without a bound, a parent
 * whose wake was genuinely lost with no later sibling, idle, or terminal event
 * would keep re-dispatching on the recovery cadence forever (issue #6546
 * round 5). One retry re-schedules one flush; each bound requires the flush to
 * actually run and observe the no-reply condition again, so the recovery
 * budget is bounded per wake generation.
 */
const MAX_SELF_SCHEDULED_RECOVERY_RETRIES = 3

type ParentWakeWindowRecoveryInput = {
  readonly sessionID: string
  readonly wake: PendingParentWake
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
  readonly requeueWake: (wake: PendingParentWake) => void
  readonly scheduleFlush: (delayMs?: number) => void
  readonly canSelfScheduleRecovery?: () => boolean
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

  const retryCount = input.wake.noAssistantOutputRetryCount ?? 0
  if (retryCount >= MAX_NO_ASSISTANT_OUTPUT_RETRIES) {
    input.dispatchedTracker.clearWake(input.sessionID)
    log("[background-agent] Stopped retrying parent wake after repeated no-output dispatch:", {
      sessionID: input.sessionID,
      retryCount,
    })
    return
  }

  input.dispatchedTracker.clearWake(input.sessionID)
  input.wake.noAssistantOutputRetryCount = retryCount + 1
  input.requeueWake(input.wake)
  input.scheduleFlush()
  log("[background-agent] Requeued dispatched parent wake after no assistant output:", {
    sessionID: input.sessionID,
    retryCount: input.wake.noAssistantOutputRetryCount,
  })
}

/**
 * Bounded self-scheduling recovery trigger for a lost FINAL or SOLE reply
 * wake (issue #6546 round 5). When the last child of a parent completes, the
 * final/sole allComplete wake may be lost downstream (e.g. the retained-wake
 * deletion path or a dropped dispatch) with no later parent, sibling, idle, or
 * terminal event to re-arm it — the parent parks forever. This trigger gives
 * the manager a bounded way to re-run the owed-wake accounting on its own
 * schedule:
 *
 * - every recovery tick, if a reply-required wake is still owed for this
 *   parent and has no live delivery (pending, dispatched, or in-flight), it is
 *   re-built exactly like a sibling transition would (the ledger is the only
 *   record of the loss), so the wake is re-queued and flushed;
 * - the schedule is SELF-RE-ARMED at most `retryLimit` times per wake
 *   generation, then it stops, so a wedged parent cannot be churned forever;
 * - the trigger is skipped entirely while the parent session is active
 *   (a live turn is streaming, and the manager's own event paths own that
 *   window) or while the parent still has running/pending children (they own
 *   the next terminal transition).
 *
 * The manager wires this to re-run its replyWakeOwedByTask sweep through the
 * serialized per-parent notification queue, preserving the once-per-task
 * delivery guard and the prompt-gate reservation semantics.
 */
export function scheduleBoundedReplyWakeRecovery(input: {
  readonly sessionID: string
  readonly retryLimit: number
  readonly retryDelayMs: number
  readonly scheduleFlush: (delayMs?: number) => void
}): void {
  input.scheduleFlush(input.retryDelayMs)
  log("[background-agent] Scheduled bounded reply-wake recovery:", {
    sessionID: input.sessionID,
    retryLimit: input.retryLimit,
    retryDelayMs: input.retryDelayMs,
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
