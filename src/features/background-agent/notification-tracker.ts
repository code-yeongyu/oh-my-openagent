import type { BackgroundTask } from "./types"

export function markForNotification(
  notifications: Map<string, BackgroundTask[]>,
  task: BackgroundTask
): void {
  const queue = notifications.get(task.parentSessionID) ?? []
  queue.push(task)
  notifications.set(task.parentSessionID, queue)
}

export function getPendingNotifications(
  notifications: Map<string, BackgroundTask[]>,
  sessionID: string
): BackgroundTask[] {
  return notifications.get(sessionID) ?? []
}

export function clearNotifications(
  notifications: Map<string, BackgroundTask[]>,
  sessionID: string
): void {
  notifications.delete(sessionID)
}

export function clearNotificationsForTask(
  notifications: Map<string, BackgroundTask[]>,
  taskId: string
): void {
  for (const [sessionID, tasks] of notifications.entries()) {
    const filtered = tasks.filter((t) => t.id !== taskId)
    if (filtered.length === 0) {
      notifications.delete(sessionID)
    } else {
      notifications.set(sessionID, filtered)
    }
  }
}

export function cleanupPendingByParent(
  pendingByParent: Map<string, Set<string>>,
  task: BackgroundTask
): void {
  if (!task.parentSessionID) return
  const pending = pendingByParent.get(task.parentSessionID)
  if (!pending) return

  pending.delete(task.id)
  if (pending.size === 0) {
    pendingByParent.delete(task.parentSessionID)
  }
}
