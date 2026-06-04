import { log } from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import type { PromptDispatchClient, PromptMessagesQuery } from "../../shared/prompt-async-gate/types"
import {
  isRedundantParentWake,
  type ParentWakePromptContext,
  type PendingParentWake,
} from "./parent-wake-dedupe"
import { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import {
  type ToolWaitDeferralDecision,
} from "./parent-wake-session-history"
import { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import { sendParentWakePrompt } from "./parent-wake-prompt-dispatch"
import {
  handleDispatchedParentWakeWindowElapsed,
  logParentWakeWindowRecoveryError,
  rescheduleParentWakeWindowRecoveryAfterError,
} from "./parent-wake-window-recovery"

type ParentWakePromptBody = ParentWakePromptContext & {
  readonly noReply?: boolean
  readonly parts: { readonly type: "text"; readonly text: string }[]
}

type ParentWakePromptAsyncInput = {
  readonly path: { readonly id: string }
  readonly body: ParentWakePromptBody
  readonly query: { readonly directory: string }
}

type ParentWakeNotifierClient = PromptDispatchClient & {
  readonly session: NonNullable<PromptDispatchClient["session"]> & {
    readonly messages: (input: {
      readonly path: { readonly id: string }
      readonly query: PromptMessagesQuery
    }) => Promise<unknown>
    readonly promptAsync: (input: ParentWakePromptAsyncInput) => Promise<unknown>
  }
}

export type { ParentWakePromptContext, PendingParentWake } from "./parent-wake-dedupe"

type ParentWakeNotifierDeps = {
  client: ParentWakeNotifierClient
  directory: string
  enqueueNotificationForParent: (parentSessionID: string | undefined, operation: () => Promise<void>) => Promise<void>
}

type ParentWakeNotifierOptions = {
  pendingRetryMs: number
  acceptedMessageSkewMs: number
  toolCallDeferMaxMs: number
  failureRequeueWindowMs: number
  /**
   * If the latest message in the parent session is a `user` message added
   * within this window, the parent-wake injection is deferred. Prevents the
   * race where a parent-wake `dispatchInternalPrompt` collides with a fresh
   * user prompt, which on macOS/Electron has triggered native SIGABRT crashes
   * inside OpenCode's `@parcel/watcher` TSFN callback path. See issue #4120.
   */
  userMessageInProgressWindowMs: number
  parentSessionActivityInProgressWindowMs?: number
}

export class ParentWakeNotifier {
  private readonly pendingQueue: ParentWakePendingQueue
  private readonly dispatchedTracker: ParentWakeDispatchedTracker
  private readonly sessionInspector: ParentWakeSessionInspector

  constructor(
    private readonly deps: ParentWakeNotifierDeps,
    private readonly options: ParentWakeNotifierOptions,
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
    if (!this.pendingQueue.hasWake(sessionID)) {
      this.clearPendingParentWakeTimer(sessionID)
      return
    }

    const sessionActive = await this.isSessionActive(sessionID)
    this.clearPendingParentWakeTimer(sessionID)
    if (!sessionActive) {
      await settleAfterSessionIdle()

      if (await this.isSessionActive(sessionID)) {
        const latestWake = this.pendingQueue.getWake(sessionID)
        if (latestWake) {
          await this.sendParentWakePrompt(sessionID, latestWake, {
            emptyAssistantTurnRetry: false,
            toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
            forceNoReply: true,
          })
        }
        return
      }
    }

    const latestWake = this.pendingQueue.getWake(sessionID)
    if (!latestWake) {
      return
    }
    if (sessionActive) {
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry: false,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
      })
      return
    }

    if (this.hasRecentParentSessionActivity(sessionID)) {
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry: false,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
      })
      log("[background-agent] Recorded admit-only parent wake because parent session activity is still fresh:", {
        sessionID,
      })
      return
    }

    const emptyAssistantTurnRetry = latestWake.allowEmptyAssistantTurnRetry === true
    const toolWaitDecision = await this.shouldDeferParentWakeForSessionHistory(sessionID, latestWake)
    if (toolWaitDecision.defer) {
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { ...toolWaitDecision, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
      })
      return
    }

    if (await this.isUserMessageInProgress(sessionID)) {
      // The user just sent a new message into the parent session. Starting a
      // reply-producing parent-wake right now would race their prompt and, on Electron-hosted
      // OpenCode (macOS arm64), has been observed to crash the sidecar via
      // @parcel/watcher TSFN callbacks firing into a torn-down JS env.
      // Store the wake as noReply so the user's own turn can consume it without
      // forking another assistant turn. See issue #4120.
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
      })
      log("[background-agent] Recorded admit-only parent wake because user message just arrived:", {
        sessionID,
      })
      return
    }

    const dispatchedWake = this.dispatchedTracker.getWake(sessionID)
    if (dispatchedWake && isRedundantParentWake(latestWake, dispatchedWake)) {
      this.pendingQueue.deleteWake(sessionID)
      log("[background-agent] Suppressed duplicate parent wake already dispatched:", { sessionID })
      return
    }

    await this.sendParentWakePrompt(sessionID, latestWake, {
      emptyAssistantTurnRetry,
      toolWaitDecision,
    })
  }

  private async sendParentWakePrompt(
    sessionID: string,
    latestWake: PendingParentWake,
    options: {
      readonly emptyAssistantTurnRetry: boolean
      readonly toolWaitDecision: ToolWaitDeferralDecision
      readonly forceNoReply?: boolean
    },
  ): Promise<void> {
    this.pendingQueue.deleteWake(sessionID)

    await sendParentWakePrompt({
      client: this.deps.client,
      directory: this.deps.directory,
      sessionID,
      latestWake,
      ...(options.forceNoReply !== undefined ? { forceNoReply: options.forceNoReply } : {}),
      emptyAssistantTurnRetry: options.emptyAssistantTurnRetry,
      toolWaitDecision: options.toolWaitDecision,
      getDispatchedWake: () => this.dispatchedTracker.getWake(sessionID),
      hasRecordedPromptAfterDispatch: (wake) =>
        this.sessionInspector.hasRecordedPromptMessageAfterDispatchedWake(sessionID, wake),
      trackDispatchedWake: (wake, dispatchedAt) => this.dispatchedTracker.trackWake(sessionID, wake, dispatchedAt),
      requeueWake: (wake) => this.requeueWake(sessionID, wake),
      scheduleFlush: (delayMs) => this.schedulePendingParentWakeFlush(sessionID, delayMs),
    })
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
    this.pendingQueue.scheduleFlush(sessionID, () => this.flushPendingParentWake(sessionID), delayMs)
  }

  clearPendingParentWakeTimer(sessionID: string): void {
    this.pendingQueue.clearTimer(sessionID)
  }

  shutdown(): void {
    this.pendingQueue.shutdown()
    this.dispatchedTracker.shutdown()
    this.sessionInspector.shutdown()
  }

  private async isSessionActive(sessionID: string): Promise<boolean> {
    return isOpenCodeSessionActive(this.deps.client, sessionID)
  }

  private hasRecentParentSessionActivity(sessionID: string): boolean {
    return this.sessionInspector.hasRecentActivity(sessionID)
  }

  private async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    return this.sessionInspector.isUserMessageInProgress(sessionID)
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    return this.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.pendingQueue.requeueWake(sessionID, latestWake)
  }
}
