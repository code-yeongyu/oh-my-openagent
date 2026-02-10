import { log } from "../../shared"

import { TASK_TTL_MS } from "./constants"
import { subagentSessions } from "../claude-code-session-state"
import { pruneStaleTasksAndNotifications } from "./task-poller"

import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"

export function pruneStaleState(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  concurrencyManager: ConcurrencyManager
  abortSession: (sessionID: string) => void
  cleanupPendingByParent: (task: BackgroundTask) => void
  clearNotificationsForTask: (taskId: string) => void
}): void {
  const {
    tasks,
    notifications,
    concurrencyManager,
    abortSession,
    cleanupPendingByParent,
    clearNotificationsForTask,
  } = args

  pruneStaleTasksAndNotifications({
    tasks,
    notifications,
    onTaskPruned: (taskId, task, errorMessage) => {
      const wasRunning = task.status === "running"
      const now = Date.now()
      const timestamp = task.status === "pending"
        ? task.queuedAt?.getTime()
        : task.startedAt?.getTime()
      const age = timestamp ? now - timestamp : TASK_TTL_MS

      log("[background-agent] Pruning stale task:", {
        taskId,
        status: task.status,
        age: Math.round(age / 1000) + "s",
      })

      task.status = "error"
      task.error = errorMessage
      task.completedAt = new Date()
      if (task.concurrencyKey) {
        concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }
      if (wasRunning && task.sessionID) {
        abortSession(task.sessionID)
      }

      cleanupPendingByParent(task)
      clearNotificationsForTask(taskId)
      tasks.delete(taskId)
      if (task.sessionID) {
        subagentSessions.delete(task.sessionID)
      }
    },
  })
}
