import { log } from "../../shared"
import { settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import type { ParentWakePromptContext, PendingParentWake } from "./parent-wake-dedupe"
import { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import { ParentWakeFlushRunner } from "./parent-wake-flush-runner"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"
import { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import type { ParentWakeNotifierDeps, ParentWakeNotifierOptions } from "./parent-wake-notifier-types"
import {
  handleDispatchedParentWakeWindowElapsed,
  logParentWakeWindowRecoveryError,
  rescheduleParentWakeWindowRecoveryAfterError,
} from "./parent-wake-window-recovery"

export type { ParentWakePromptContext, PendingParentWake } from "./parent-wake-dedupe"

const DEFAULT_PARENT_WAKE_MAX_DEFER_MS = 120_000
const DEFAULT_PARENT_WAKE_MAX_WINDOW_REFRESHES = 3

export class ParentWakeNotifier {
  private readonly pendingQueue: ParentWakePendingQueue
  private readonly dispatchedTracker: ParentWakeDispatchedTracker
  private readonly sessionInspector: ParentWakeSessionInspector
  private readonly flushRunner: ParentWakeFlushRunner

  constructor(
    deps: ParentWakeNotifierDeps,
    options: ParentWakeNotifierOptions,
  ) {
    this.pendingQueue = new ParentWakePendingQueue({
      pendingRetryMs: options.pendingRetryMs,
      enqueueNotificationForParent: deps.enqueueNotificationForParent,
    })
    this.dispatchedTracker = new ParentWakeDispatchedTracker({
      failureRequeueWindowMs: options.failureRequeueWindowMs,
      onFailureRequeueWindowElapsed: (sessionID, wake) => {
        void handleDispatchedParentWakeWindowElapsed({
          sessionID,
          wake,
          dispatchedTracker: this.dispatchedTracker,
          sessionInspector: this.sessionInspector,
          pendingQueue: this.pendingQueue,
          scheduleFlush: (id) => this.flushRunner.schedulePendingParentWakeFlush(id),
          maxWindowRefreshes: options.maxWindowRefreshes ?? DEFAULT_PARENT_WAKE_MAX_WINDOW_REFRESHES,
        }).catch((error: unknown) => {
          logParentWakeWindowRecoveryError(
            sessionID,
            error,
          )
          rescheduleParentWakeWindowRecoveryAfterError(
            sessionID,
            wake,
            this.dispatchedTracker,
          )
        })
      },
    })
    this.sessionInspector = new ParentWakeSessionInspector(deps.client, {
      directory: deps.directory,
      acceptedMessageSkewMs: options.acceptedMessageSkewMs,
      toolCallDeferMaxMs: options.toolCallDeferMaxMs,
      userMessageInProgressWindowMs: options.userMessageInProgressWindowMs,
      parentSessionActivityInProgressWindowMs: options.parentSessionActivityInProgressWindowMs,
    })
    this.flushRunner = new ParentWakeFlushRunner({
      notifierDeps: deps,
      pendingQueue: this.pendingQueue,
      dispatchedTracker: this.dispatchedTracker,
      sessionInspector: this.sessionInspector,
      maxDeferMs: options.maxDeferMs ?? DEFAULT_PARENT_WAKE_MAX_DEFER_MS,
    })
  }

  getPendingParentWakes(): Map<string, PendingParentWake> {
    return this.pendingQueue.getWakes()
  }

  getPendingParentWakeTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.pendingQueue.getTimers()
  }

  getDispatchedParentWakes(): Map<string, PendingParentWake> {
    return this.dispatchedTracker.getWakes()
  }

  getDispatchedParentWakeTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.dispatchedTracker.getTimers()
  }

  recordParentSessionActivity(sessionID: string): void {
    this.sessionInspector.recordActivity(sessionID)
  }

  queuePendingParentWake(
    sessionID: string,
    notification: string,
    promptContext: ParentWakePromptContext,
    shouldReply: boolean,
    delayMs?: number,
  ): void {
    this.pendingQueue.queueWake(sessionID, notification, promptContext, shouldReply)
    this.schedulePendingParentWakeFlush(sessionID, delayMs)
  }

  async flushPendingParentWake(sessionID: string): Promise<void> {
    await this.flushRunner.flushPendingParentWake(sessionID)
  }

  clearDispatchedParentWake(sessionID: string): void {
    this.dispatchedTracker.clearWake(sessionID)
  }

  async requeueDispatchedParentWake(sessionID: string, reason: string): Promise<boolean> {
    const wake = this.dispatchedTracker.getWake(sessionID)
    if (!wake) {
      return false
    }

    await settleAfterSessionIdle()

    if (await this.sessionInspector.hasAssistantOrToolOutputAfterDispatchedWake(sessionID, wake)) {
      this.clearDispatchedParentWake(sessionID)
      log("[background-agent] Ignored late parent wake failure after assistant output:", {
        sessionID,
        reason,
      })
      return false
    }

    this.dispatchedTracker.clearWake(sessionID)
    this.requeueWake(sessionID, wake)
    this.schedulePendingParentWakeFlush(sessionID)
    log("[background-agent] Requeued dispatched parent wake after prompt failure:", {
      sessionID,
      reason,
    })
    return true
  }

  requeueDispatchedParentWakeAfterEmptyAssistantTurn(sessionID: string): boolean {
    const wake = this.dispatchedTracker.getWake(sessionID)
    if (!wake) {
      return false
    }

    this.dispatchedTracker.clearWake(sessionID)
    wake.allowEmptyAssistantTurnRetry = true
    this.requeueWake(sessionID, wake)
    this.schedulePendingParentWakeFlush(sessionID, 0)
    log("[background-agent] Requeued dispatched parent wake after empty assistant turn:", { sessionID })
    return true
  }

  schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void {
    this.flushRunner.schedulePendingParentWakeFlush(sessionID, delayMs)
  }

  clearPendingParentWakeTimer(sessionID: string): void {
    this.flushRunner.clearPendingParentWakeTimer(sessionID)
  }

  shutdown(): void {
    this.pendingQueue.shutdown()
    this.dispatchedTracker.shutdown()
    this.sessionInspector.shutdown()
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.pendingQueue.requeueWake(sessionID, latestWake)
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    return this.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }
}
