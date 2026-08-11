import { log } from "../../shared"
import { settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import type { ParentWakePromptContext, PendingParentWake } from "./parent-wake-dedupe"
import { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import { ParentWakeFlushRunner } from "./parent-wake-flush-runner"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import { sendParentWakePrompt } from "./parent-wake-prompt-dispatch"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"
import { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import type { ParentWakeNotifierClient, ParentWakeNotifierDeps, ParentWakeNotifierOptions } from "./parent-wake-notifier-types"
import {
  handleDispatchedParentWakeWindowElapsed,
  logParentWakeWindowRecoveryError,
  rescheduleParentWakeWindowRecoveryAfterError,
} from "./parent-wake-window-recovery"

export type { ParentWakePromptContext, PendingParentWake } from "./parent-wake-dedupe"

export class ParentWakeNotifier {
  private readonly client: ParentWakeNotifierClient
  private readonly directory: string
  private readonly pendingQueue: ParentWakePendingQueue
  private readonly dispatchedTracker: ParentWakeDispatchedTracker
  private readonly sessionInspector: ParentWakeSessionInspector
  private readonly flushRunner: ParentWakeFlushRunner
  private readonly onPendingWakeRequeued?: (sessionID: string) => void

  constructor(
    deps: ParentWakeNotifierDeps,
    options: ParentWakeNotifierOptions,
  ) {
    this.client = deps.client
    this.directory = deps.directory
    this.onPendingWakeRequeued = deps.onPendingWakeRequeued
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
          requeueWake: (latestWake) => this.requeueWake(sessionID, latestWake),
          scheduleFlush: () => this.schedulePendingParentWakeFlush(sessionID),
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

  hasInFlightParentWakeDispatch(sessionID: string): boolean {
    return this.dispatchedTracker.hasInFlight(sessionID)
  }

  reserveNotificationPreparation(sessionID: string): void {
    this.dispatchedTracker.reserveNotificationPreparation(sessionID)
  }

  releaseNotificationPreparation(sessionID: string): void {
    this.dispatchedTracker.releaseNotificationPreparation(sessionID)
  }

  hasNotificationPreparation(sessionID: string): boolean {
    return this.dispatchedTracker.hasNotificationPreparation(sessionID)
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

  /**
   * Flush all pending parent wake notifications before the process exits.
   *
   * In headless `opencode run` mode, when the model stops with reason=stop the
   * parent session goes idle and run.ts breaks its event loop. The pending
   * wake notifications (scheduled via unref'd timers in
   * ParentWakePendingQueue.scheduleFlush) would be lost when the process
   * exits because unref'd timers do not keep the event loop alive.
   *
   * This method dispatches each pending wake directly via sendParentWakePrompt
   * with forceNoReply=true, which persists the notification text in the parent
   * session without re-triggering the model. The user can then re-attach
   * (e.g. `opencode run --continue`) and the model will see the notification.
   */
  async flushForShutdown(): Promise<void> {
    const wakes = this.pendingQueue.getWakes()
    if (wakes.size === 0) return

    log("[background-agent] Flushing pending parent wake notifications before shutdown:", {
      count: wakes.size,
      sessionIDs: [...wakes.keys()],
    })

    const noOpToolWaitDecision: ToolWaitDeferralDecision = {
      defer: false,
      skipPromptGateToolStateCheck: true,
    }

    const flushPromises: Promise<void>[] = []
    for (const [sessionID, wake] of wakes) {
      flushPromises.push(
        sendParentWakePrompt({
          client: this.client,
          directory: this.directory,
          sessionID,
          latestWake: wake,
          forceNoReply: true,
          emptyAssistantTurnRetry: false,
          toolWaitDecision: noOpToolWaitDecision,
          getDispatchedWake: () => undefined,
          hasRecordedPromptAfterDispatch: async () => false,
          trackDispatchedWake: () => {},
          requeueWake: () => {},
          scheduleFlush: () => {},
        }).catch((error) => {
          log("[background-agent] Failed to flush parent wake for shutdown:", {
            sessionID,
            error,
          })
        }),
      )
    }

    // Wait with a 3-second timeout so we don't hang the process during shutdown
    await Promise.race([
      Promise.allSettled(flushPromises),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ])
  }

  shutdown(): void {
    this.pendingQueue.shutdown()
    this.dispatchedTracker.shutdown()
    this.sessionInspector.shutdown()
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.pendingQueue.requeueWake(sessionID, latestWake)
    this.onPendingWakeRequeued?.(sessionID)
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    return this.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }
}
