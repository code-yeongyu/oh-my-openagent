import { log } from "../../shared"
import type { PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"

type ParentWakeWindowRecoveryInput = {
  readonly sessionID: string
  readonly wake: PendingParentWake
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
  readonly pendingQueue: ParentWakePendingQueue
  readonly scheduleFlush: (sessionID: string) => void
  readonly maxWindowRefreshes: number
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

  // BUG B3: OpenCode can accept a prompt and then silently drop it. The 5s
  // failure window would otherwise refresh forever, leaving the wake stuck
  // "dispatched" with no assistant/tool output ever arriving. After
  // maxWindowRefreshes consecutive empty windows (~15s) requeue the dispatched
  // wake into the pending queue so the normal flush flow re-delivers it.
  const windowRefreshCount = (currentWake.windowRefreshCount ?? 0) + 1
  if (windowRefreshCount >= input.maxWindowRefreshes) {
    input.dispatchedTracker.clearWake(input.sessionID)
    input.pendingQueue.requeueWake(input.sessionID, currentWake)
    input.scheduleFlush(input.sessionID)
    log("[background-agent] Requeued silently-dropped dispatched parent wake after repeated empty recovery windows:", {
      sessionID: input.sessionID,
      windowRefreshes: windowRefreshCount,
    })
    return
  }

  currentWake.windowRefreshCount = windowRefreshCount
  input.dispatchedTracker.refreshWakeTimer(input.sessionID)
  log("[background-agent] Kept dispatched parent wake awaiting late failure or assistant output:", {
    sessionID: input.sessionID,
    windowRefreshes: windowRefreshCount,
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
