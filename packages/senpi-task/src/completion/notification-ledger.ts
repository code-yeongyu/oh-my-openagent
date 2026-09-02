import { log } from "@oh-my-opencode/utils"

import type { CompletionNotifierStore } from "./types"

export function persistNotified(store: CompletionNotifierStore, taskId: string, epoch: number): void {
  store.mutate(taskId, (fresh) =>
    fresh.notification.notified_epoch >= epoch
      ? fresh
      : { ...fresh, notification: { ...fresh.notification, notified_epoch: epoch } },
  )
}

export function recordNotificationFailure(
  store: CompletionNotifierStore,
  taskId: string,
  epoch: number,
  error: unknown,
): void {
  store.appendEvent(taskId, { type: "notification_failed", payload: { epoch, error: String(error) } })
  store.mutate(taskId, (fresh) =>
    fresh.notification.notified_epoch >= epoch || fresh.notification.notification_failed_epoch === epoch
      ? fresh
      : { ...fresh, notification: { ...fresh.notification, notification_failed_epoch: epoch } },
  )
  log("senpi-task completion delivery failed", { taskId, epoch })
}

export function recordNotificationDrop(store: CompletionNotifierStore, taskId: string, epoch: number): void {
  store.appendEvent(taskId, { type: "notification_dropped", payload: { epoch } })
  log("senpi-task completion dropped for replaced session", { taskId, epoch })
}
