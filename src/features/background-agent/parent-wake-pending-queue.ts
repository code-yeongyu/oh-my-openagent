import { log } from "../../shared"
import {
  cloneParentWake,
  mergeParentWakeNotifications,
  resolveParentWakePromptContext,
  type ParentWakePromptContext,
  type PendingParentWake,
} from "./parent-wake-dedupe"
import { unrefTimerHandle } from "./parent-wake-timer-handle"

type ParentWakePendingQueueOptions = {
  readonly pendingRetryMs: number
  readonly enqueueNotificationForParent: (
    parentSessionID: string | undefined,
    operation: () => Promise<void>,
  ) => Promise<void>
}

export class ParentWakePendingQueue {
  private pendingParentWakes: Map<string, PendingParentWake> = new Map()
  private pendingParentWakeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  constructor(private readonly options: ParentWakePendingQueueOptions) {}

  getWakes(): Map<string, PendingParentWake> {
    return this.pendingParentWakes
  }

  getTimers(): Map<string, ReturnType<typeof setTimeout>> {
    return this.pendingParentWakeTimers
  }

  hasWake(sessionID: string): boolean {
    return this.pendingParentWakes.has(sessionID)
  }

  getWake(sessionID: string): PendingParentWake | undefined {
    return this.pendingParentWakes.get(sessionID)
  }

  deleteWake(sessionID: string): void {
    this.pendingParentWakes.delete(sessionID)
  }

  queueWake(
    sessionID: string,
    notification: string,
    promptContext: ParentWakePromptContext,
    shouldReply: boolean,
  ): void {
    const resolvedPromptContext = resolveParentWakePromptContext(promptContext)
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      const mergedNotifications = mergeParentWakeNotifications(pendingWake.notifications, notification)
      const notificationsChanged = mergedNotifications.length !== pendingWake.notifications.length
        || mergedNotifications.some((merged, index) => merged !== pendingWake.notifications[index])
      pendingWake.notifications = mergedNotifications
      pendingWake.promptContext = resolvedPromptContext
      pendingWake.shouldReply = pendingWake.shouldReply || shouldReply
      if (notificationsChanged) {
        delete pendingWake.noReplyAdmittedAt
      }
      return
    }

    this.pendingParentWakes.set(sessionID, {
      promptContext: resolvedPromptContext,
      notifications: [notification],
      shouldReply,
    })
  }

  requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      pendingWake.notifications = pendingWake.notifications.reduce(
        (notifications, notification) => mergeParentWakeNotifications(notifications, notification),
        [...latestWake.notifications],
      )
      pendingWake.shouldReply = pendingWake.shouldReply || latestWake.shouldReply
      pendingWake.promptContext = latestWake.promptContext
      pendingWake.noReplyAdmittedAt ??= latestWake.noReplyAdmittedAt
      pendingWake.toolCallDeferralStartedAt ??= latestWake.toolCallDeferralStartedAt
      pendingWake.allowEmptyAssistantTurnRetry ||= latestWake.allowEmptyAssistantTurnRetry
      return
    }
    this.pendingParentWakes.set(sessionID, cloneParentWake(latestWake))
  }

  scheduleFlush(sessionID: string, operation: () => Promise<void>, delayMs?: number): void {
    if (this.pendingParentWakeTimers.has(sessionID)) {
      return
    }

    const timer = setTimeout(() => {
      this.pendingParentWakeTimers.delete(sessionID)
      void this.options.enqueueNotificationForParent(sessionID, operation).catch((error) => {
        log("[background-agent] Failed to retry pending parent wake:", { sessionID, error })
      })
    }, delayMs ?? this.options.pendingRetryMs)
    unrefTimerHandle(timer)

    this.pendingParentWakeTimers.set(sessionID, timer)
  }

  clearTimer(sessionID: string): void {
    const timer = this.pendingParentWakeTimers.get(sessionID)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.pendingParentWakeTimers.delete(sessionID)
  }

  shutdown(): void {
    for (const timer of this.pendingParentWakeTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingParentWakeTimers.clear()
    this.pendingParentWakes.clear()
  }
}
