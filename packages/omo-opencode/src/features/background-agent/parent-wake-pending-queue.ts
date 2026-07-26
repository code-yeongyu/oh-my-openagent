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

type LatestParentWake = {
  readonly sessionID: string
  readonly notification: string
  readonly promptContext: ParentWakePromptContext
  readonly shouldReply: boolean
  readonly latestOnlyKey: string
}

type ParentWakeToStore = Omit<LatestParentWake, "latestOnlyKey"> & {
  readonly latestOnlyKey?: string
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
    this.storeWake({ sessionID, notification, promptContext, shouldReply })
  }

  queueLatestWake(wake: LatestParentWake): void {
    this.storeWake(wake)
  }

  private storeWake(wake: ParentWakeToStore): void {
    const { sessionID, notification, promptContext, shouldReply, latestOnlyKey } = wake
    const now = Date.now()
    const resolvedPromptContext = resolveParentWakePromptContext(promptContext)
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      pendingWake.queuedAt ??= now
      const replyEscalated = !pendingWake.shouldReply && shouldReply
      const previousLatest = latestOnlyKey
        ? pendingWake.latestOnlyNotifications?.get(latestOnlyKey)
        : undefined
      let notificationsWithoutPrevious = pendingWake.notifications
      if (latestOnlyKey && previousLatest !== undefined && previousLatest !== notification) {
        notificationsWithoutPrevious = this.removeLatestOnlyReference(pendingWake, latestOnlyKey)
      }
      const mergedNotifications = mergeParentWakeNotifications(notificationsWithoutPrevious, notification)
      const notificationsChanged = mergedNotifications.length !== pendingWake.notifications.length
        || mergedNotifications.some((merged, index) => merged !== pendingWake.notifications[index])
      pendingWake.notifications = mergedNotifications
      if (latestOnlyKey && mergedNotifications.includes(notification)) {
        pendingWake.latestOnlyNotifications ??= new Map()
        pendingWake.latestOnlyNotifications.set(latestOnlyKey, notification)
      }
      this.pruneLatestOnlyNotifications(pendingWake)
      pendingWake.promptContext = resolvedPromptContext
      pendingWake.shouldReply = pendingWake.shouldReply || shouldReply
      if (replyEscalated) {
        pendingWake.queuedAt = now
        delete pendingWake.noReplyAdmittedAt
        delete pendingWake.toolCallDeferralStartedAt
        delete pendingWake.allowEmptyAssistantTurnRetry
        delete pendingWake.noAssistantOutputRetryCount
      }
      if (notificationsChanged) {
        delete pendingWake.noReplyAdmittedAt
        delete pendingWake.noAssistantOutputRetryCount
      }
      return
    }

    this.pendingParentWakes.set(sessionID, {
      promptContext: resolvedPromptContext,
      notifications: [notification],
      ...(latestOnlyKey ? { latestOnlyNotifications: new Map([[latestOnlyKey, notification]]) } : {}),
      shouldReply,
      queuedAt: now,
    })
  }

  requeueWake(sessionID: string, latestWake: PendingParentWake): void {
    const now = Date.now()
    const pendingWake = this.pendingParentWakes.get(sessionID)
    if (pendingWake) {
      const replyEscalated = !pendingWake.shouldReply && latestWake.shouldReply
      const existingQueuedAt = pendingWake.queuedAt ?? now
      const latestQueuedAt = latestWake.queuedAt ?? now
      pendingWake.queuedAt = Math.min(existingQueuedAt, latestQueuedAt)
      const latestOnlyNotifications = new Map(latestWake.latestOnlyNotifications)
      let mergedNotifications = [...latestWake.notifications]
      for (const [key, notification] of pendingWake.latestOnlyNotifications ?? []) {
        const previous = latestOnlyNotifications.get(key)
        if (previous !== undefined && previous !== notification) {
          latestOnlyNotifications.delete(key)
          if (![...latestOnlyNotifications.values()].includes(previous)) {
            mergedNotifications = mergedNotifications.filter((candidate) => candidate !== previous)
          }
        }
        mergedNotifications = mergeParentWakeNotifications(mergedNotifications, notification)
        latestOnlyNotifications.set(key, notification)
      }
      const pendingLatestValues = new Set(pendingWake.latestOnlyNotifications?.values() ?? [])
      for (const notification of pendingWake.notifications) {
        if (!pendingLatestValues.has(notification)) {
          mergedNotifications = mergeParentWakeNotifications(mergedNotifications, notification)
        }
      }
      pendingWake.notifications = mergedNotifications
      pendingWake.latestOnlyNotifications = latestOnlyNotifications
      this.pruneLatestOnlyNotifications(pendingWake)
      pendingWake.shouldReply = pendingWake.shouldReply || latestWake.shouldReply
      pendingWake.promptContext = latestWake.promptContext
      if (replyEscalated) {
        pendingWake.queuedAt = now
        delete pendingWake.noReplyAdmittedAt
        delete pendingWake.toolCallDeferralStartedAt
        delete pendingWake.allowEmptyAssistantTurnRetry
        delete pendingWake.noAssistantOutputRetryCount
      } else {
        pendingWake.noReplyAdmittedAt ??= latestWake.noReplyAdmittedAt
        pendingWake.toolCallDeferralStartedAt ??= latestWake.toolCallDeferralStartedAt
        pendingWake.allowEmptyAssistantTurnRetry ||= latestWake.allowEmptyAssistantTurnRetry
        const noAssistantOutputRetryCount = Math.max(
          pendingWake.noAssistantOutputRetryCount ?? 0,
          latestWake.noAssistantOutputRetryCount ?? 0,
        )
        if (noAssistantOutputRetryCount > 0) {
          pendingWake.noAssistantOutputRetryCount = noAssistantOutputRetryCount
        }
      }
      return
    }
    const clonedWake = cloneParentWake(latestWake)
    clonedWake.queuedAt ??= now
    this.pendingParentWakes.set(sessionID, clonedWake)
  }

  removeLatestOnlyNotifications(sessionID: string, keys: readonly string[]): void {
    const wake = this.pendingParentWakes.get(sessionID)
    if (!wake?.latestOnlyNotifications) return
    for (const key of keys) {
      wake.notifications = this.removeLatestOnlyReference(wake, key)
    }
    if (wake.latestOnlyNotifications.size === 0) delete wake.latestOnlyNotifications
    if (wake.notifications.length === 0) {
      this.deleteWake(sessionID)
      this.clearTimer(sessionID)
    }
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

  private pruneLatestOnlyNotifications(wake: PendingParentWake): void {
    if (!wake.latestOnlyNotifications) return
    const retained = new Set(wake.notifications)
    for (const [key, notification] of wake.latestOnlyNotifications) {
      if (!retained.has(notification)) wake.latestOnlyNotifications.delete(key)
    }
    if (wake.latestOnlyNotifications.size === 0) delete wake.latestOnlyNotifications
  }

  private removeLatestOnlyReference(wake: PendingParentWake, key: string): string[] {
    const notification = wake.latestOnlyNotifications?.get(key)
    if (notification === undefined) return wake.notifications
    wake.latestOnlyNotifications?.delete(key)
    if ([...(wake.latestOnlyNotifications?.values() ?? [])].includes(notification)) {
      return wake.notifications
    }
    return wake.notifications.filter((candidate) => candidate !== notification)
  }
}
