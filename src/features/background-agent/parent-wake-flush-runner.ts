import { log } from "../../shared"
import { isSessionActive as isOpenCodeSessionActive, settleAfterSessionIdle } from "../../hooks/shared/session-idle-settle"
import { isRedundantParentWake, type PendingParentWake } from "./parent-wake-dedupe"
import type { ParentWakeDispatchedTracker } from "./parent-wake-dispatched-tracker"
import type { ParentWakePendingQueue } from "./parent-wake-pending-queue"
import { sendParentWakePrompt } from "./parent-wake-prompt-dispatch"
import type { ToolWaitDeferralDecision } from "./parent-wake-session-history"
import type { ParentWakeSessionInspector } from "./parent-wake-session-inspector"
import type { ParentWakeNotifierDeps } from "./parent-wake-notifier-types"

type ParentWakeFlushRunnerDeps = {
  readonly notifierDeps: ParentWakeNotifierDeps
  readonly pendingQueue: ParentWakePendingQueue
  readonly dispatchedTracker: ParentWakeDispatchedTracker
  readonly sessionInspector: ParentWakeSessionInspector
}

export class ParentWakeFlushRunner {
  constructor(private readonly deps: ParentWakeFlushRunnerDeps) {}

  async flushPendingParentWake(sessionID: string): Promise<void> {
    if (!this.deps.pendingQueue.hasWake(sessionID)) {
      this.clearPendingParentWakeTimer(sessionID)
      return
    }

    const sessionActive = await this.isSessionActive(sessionID)
    this.clearPendingParentWakeTimer(sessionID)
    if (!sessionActive) {
      await settleAfterSessionIdle()

      if (await this.isSessionActive(sessionID)) {
        const latestWake = this.deps.pendingQueue.getWake(sessionID)
        if (latestWake) {
          if (this.deferUnsafeReplyWake(sessionID, latestWake)) {
            return
          }
          if (this.deferRetainedNoReplyWake(sessionID, latestWake)) {
            return
          }
          await this.sendParentWakePrompt(sessionID, latestWake, {
            emptyAssistantTurnRetry: false,
            toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
            forceNoReply: true,
            retainPendingWake: isReplyRequiredFinalWake(latestWake),
          })
        }
        return
      }
    }

    const latestWake = this.deps.pendingQueue.getWake(sessionID)
    if (!latestWake) {
      return
    }
    if (sessionActive) {
      if (this.deferUnsafeReplyWake(sessionID, latestWake)) {
        return
      }
      if (this.deferRetainedNoReplyWake(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry: false,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: isReplyRequiredFinalWake(latestWake),
      })
      return
    }

    if (this.hasRecentParentSessionActivity(sessionID)) {
      if (this.deferUnsafeReplyWake(sessionID, latestWake)) {
        return
      }
      if (this.deferRetainedNoReplyWake(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry: false,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: isReplyRequiredFinalWake(latestWake),
      })
      log("[background-agent] Recorded admit-only parent wake because parent session activity is still fresh:", {
        sessionID,
      })
      return
    }

    const emptyAssistantTurnRetry = latestWake.allowEmptyAssistantTurnRetry === true
    const toolWaitDecision = await this.shouldDeferParentWakeForSessionHistory(sessionID, latestWake)
    if (toolWaitDecision.defer) {
      if (this.deferUnsafeReplyWake(sessionID, latestWake)) {
        return
      }
      if (this.deferRetainedNoReplyWake(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { ...toolWaitDecision, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: isReplyRequiredFinalWake(latestWake),
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
      if (this.deferUnsafeReplyWake(sessionID, latestWake)) {
        return
      }
      if (this.deferRetainedNoReplyWake(sessionID, latestWake)) {
        return
      }
      await this.sendParentWakePrompt(sessionID, latestWake, {
        emptyAssistantTurnRetry,
        toolWaitDecision: { defer: false, skipPromptGateToolStateCheck: true },
        forceNoReply: true,
        retainPendingWake: isReplyRequiredFinalWake(latestWake),
      })
      log("[background-agent] Recorded admit-only parent wake because user message just arrived:", {
        sessionID,
      })
      return
    }

    const dispatchedWake = this.deps.dispatchedTracker.getWake(sessionID)
    if (dispatchedWake && isRedundantParentWake(latestWake, dispatchedWake)) {
      this.deps.pendingQueue.deleteWake(sessionID)
      log("[background-agent] Suppressed duplicate parent wake already dispatched:", { sessionID })
      return
    }

    await this.sendParentWakePrompt(sessionID, latestWake, {
      emptyAssistantTurnRetry,
      toolWaitDecision,
    })
  }

  private deferUnsafeReplyWake(sessionID: string, latestWake: PendingParentWake): boolean {
    if (!isFailureParentWake(latestWake)) {
      return false
    }
    this.schedulePendingParentWakeFlush(sessionID)
    log("[background-agent] Deferred failure parent wake until parent session is safe:", { sessionID })
    return true
  }

  private deferRetainedNoReplyWake(sessionID: string, latestWake: PendingParentWake): boolean {
    if (!isReplyRequiredFinalWake(latestWake) || latestWake.noReplyAdmittedAt === undefined) {
      return false
    }
    this.schedulePendingParentWakeFlush(sessionID)
    log("[background-agent] Deferred retained final parent wake until parent session is safe:", { sessionID })
    return true
  }

  schedulePendingParentWakeFlush(sessionID: string, delayMs?: number): void {
    this.deps.pendingQueue.scheduleFlush(sessionID, () => this.flushPendingParentWake(sessionID), delayMs)
  }

  clearPendingParentWakeTimer(sessionID: string): void {
    this.deps.pendingQueue.clearTimer(sessionID)
  }

  private async sendParentWakePrompt(
    sessionID: string,
    latestWake: PendingParentWake,
    options: {
      readonly emptyAssistantTurnRetry: boolean
      readonly toolWaitDecision: ToolWaitDeferralDecision
      readonly forceNoReply?: boolean
      readonly retainPendingWake?: boolean
    },
  ): Promise<void> {
    if (options.retainPendingWake !== true) {
      this.deps.pendingQueue.deleteWake(sessionID)
    }

    await sendParentWakePrompt({
      client: this.deps.notifierDeps.client,
      directory: this.deps.notifierDeps.directory,
      sessionID,
      latestWake,
      ...(options.forceNoReply !== undefined ? { forceNoReply: options.forceNoReply } : {}),
      ...(options.retainPendingWake !== undefined ? { retainPendingWake: options.retainPendingWake } : {}),
      emptyAssistantTurnRetry: options.emptyAssistantTurnRetry,
      toolWaitDecision: options.toolWaitDecision,
      getDispatchedWake: () => this.deps.dispatchedTracker.getWake(sessionID),
      hasRecordedPromptAfterDispatch: (wake) =>
        this.deps.sessionInspector.hasRecordedPromptMessageAfterDispatchedWake(sessionID, wake),
      trackDispatchedWake: (wake, dispatchedAt) => this.deps.dispatchedTracker.trackWake(sessionID, wake, dispatchedAt),
      requeueWake: (wake) => this.requeueWake(sessionID, wake),
      scheduleFlush: (delayMs) => this.schedulePendingParentWakeFlush(sessionID, delayMs),
    })
  }

  private async isSessionActive(sessionID: string): Promise<boolean> {
    return isOpenCodeSessionActive(this.deps.notifierDeps.client, sessionID)
  }

  private hasRecentParentSessionActivity(sessionID: string): boolean {
    return this.deps.sessionInspector.hasRecentActivity(sessionID)
  }

  private async isUserMessageInProgress(sessionID: string): Promise<boolean> {
    return this.deps.sessionInspector.isUserMessageInProgress(sessionID)
  }

  private async shouldDeferParentWakeForSessionHistory(
    sessionID: string,
    wake: PendingParentWake,
  ): Promise<ToolWaitDeferralDecision> {
    return this.deps.sessionInspector.shouldDeferForHistory(sessionID, wake)
  }

  private requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    this.deps.pendingQueue.requeueWake(sessionID, latestWake)
  }
}

function isReplyRequiredFinalWake(wake: PendingParentWake): boolean {
  return wake.shouldReply && wake.notifications.some((notification) =>
    notification.includes("[ALL BACKGROUND TASKS COMPLETE]")
  )
}

function isFailureParentWake(wake: PendingParentWake): boolean {
  return wake.shouldReply && wake.notifications.some((notification) =>
    notification.includes("[BACKGROUND TASK ERROR]")
    || notification.includes("[BACKGROUND TASK CANCELLED]")
    || notification.includes("[BACKGROUND TASK INTERRUPTED]")
    || notification.includes("[ALL BACKGROUND TASKS FINISHED")
  )
}
