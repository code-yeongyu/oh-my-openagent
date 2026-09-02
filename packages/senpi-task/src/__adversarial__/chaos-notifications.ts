import type { CompletionDetails, CompletionNotifier, ParentNotifier, ParentNotifierMessage } from "../completion"
import type { TaskRecordStore } from "../store"
import type { StoreObservations } from "./observing-store"

export type ChaosNotifier = ParentNotifier & {
  readonly calls: ParentNotifierMessage[]
  failNext(count: number): void
  deferNext(): void
  hasPending(taskId: string, epoch: number): boolean
  resolvePending(): void
}

type NotificationEpochTracker = {
  readonly activeByTask: Map<string, number>
  readonly bufferedByTask: Map<string, number[]>
  readonly detailEpochs: WeakMap<CompletionDetails, number>
}

export function createNotificationEpochTracker(): NotificationEpochTracker {
  return { activeByTask: new Map(), bufferedByTask: new Map(), detailEpochs: new WeakMap() }
}

function rememberBufferedEpoch(tracker: NotificationEpochTracker, taskId: string, epoch: number): void {
  const epochs = tracker.bufferedByTask.get(taskId) ?? []
  if (!epochs.includes(epoch)) epochs.push(epoch)
  tracker.bufferedByTask.set(taskId, epochs)
}

function resolveDetailEpoch(tracker: NotificationEpochTracker, store: TaskRecordStore, detail: CompletionDetails): number {
  const tagged = tracker.detailEpochs.get(detail)
  if (tagged !== undefined) return tagged
  const active = tracker.activeByTask.get(detail.task_id)
  if (active !== undefined) {
    tracker.detailEpochs.set(detail, active)
    return active
  }
  const buffered = tracker.bufferedByTask.get(detail.task_id)
  const bufferedEpoch = buffered?.shift()
  if (buffered?.length === 0) tracker.bufferedByTask.delete(detail.task_id)
  const epoch = bufferedEpoch ?? store.load(detail.task_id)?.notification.run_epoch ?? 0
  tracker.detailEpochs.set(detail, epoch)
  return epoch
}

export function createChaosNotifier(
  store: TaskRecordStore,
  observations: StoreObservations,
  epochs: NotificationEpochTracker,
): ChaosNotifier {
  const calls: ParentNotifierMessage[] = []
  let remainingFailures = 0
  let deferNext = false
  const pendingKeys = new Set<string>()
  const pendingResolutions: Array<() => void> = []
  return {
    calls,
    failNext(count) {
      remainingFailures = count
    },
    deferNext() {
      deferNext = true
    },
    hasPending(taskId, epoch) {
      return pendingKeys.has(`${taskId}:${epoch}`)
    },
    resolvePending() {
      for (const resolve of pendingResolutions.splice(0)) resolve()
    },
    enqueue(message) {
      const tagged = message.details.map((detail) => ({ detail, epoch: resolveDetailEpoch(epochs, store, detail) }))
      if (remainingFailures > 0) {
        remainingFailures -= 1
        throw new Error("chaos parent gone")
      }
      calls.push(message)
      for (const entry of tagged) {
        const key = `${entry.detail.task_id}:${entry.epoch}`
        observations.enqueueByEpoch.set(key, (observations.enqueueByEpoch.get(key) ?? 0) + 1)
      }
      if (!deferNext) return
      deferNext = false
      const keys = tagged.map((entry) => `${entry.detail.task_id}:${entry.epoch}`)
      for (const key of keys) pendingKeys.add(key)
      return new Promise<void>((resolve) => {
        pendingResolutions.push(() => {
          for (const key of keys) pendingKeys.delete(key)
          resolve()
        })
      })
    },
  }
}

export function instrumentCompletionNotifier(
  notifier: CompletionNotifier,
  store: TaskRecordStore,
  epochs: NotificationEpochTracker,
): CompletionNotifier {
  return {
    notifyTerminal(request) {
      const taskId = request.record.task_id
      epochs.activeByTask.set(taskId, request.record.notification.run_epoch)
      try {
        const result = notifier.notifyTerminal(request)
        if (result.kind === "buffered") rememberBufferedEpoch(epochs, taskId, request.record.notification.run_epoch)
        return result
      } finally {
        epochs.activeByTask.delete(taskId)
      }
    },
    flushBuffered(input) {
      try {
        return notifier.flushBuffered(input)
      } finally {
        epochs.bufferedByTask.clear()
      }
    },
    reconcileUnnotifiedNotifications(input) {
      const records = store.list().records
      for (const record of records) epochs.activeByTask.set(record.task_id, record.notification.run_epoch)
      try {
        notifier.reconcileUnnotifiedNotifications(input)
      } finally {
        for (const record of records) epochs.activeByTask.delete(record.task_id)
      }
    },
    reconcileFailedNotifications(input) {
      this.reconcileUnnotifiedNotifications(input)
    },
    bufferedCount: (sessionId) => notifier.bufferedCount(sessionId),
  }
}
