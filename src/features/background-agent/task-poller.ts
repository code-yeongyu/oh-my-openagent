import { log } from "../../shared"

import type { BackgroundTaskConfig } from "../../config/schema"
import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

import {
  DEFAULT_STALE_TIMEOUT_MS,
  MIN_RUNTIME_BEFORE_STALE_MS,
  TASK_TTL_MS,
} from "./constants"

export function pruneStaleTasksAndNotifications(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  onTaskPruned: (taskId: string, task: BackgroundTask, errorMessage: string) => void
}): void {
  const { tasks, notifications, onTaskPruned } = args
  const now = Date.now()

  for (const [taskId, task] of tasks.entries()) {
    const timestamp = task.status === "pending"
      ? task.queuedAt?.getTime()
      : task.startedAt?.getTime()

    if (!timestamp) continue

    const age = now - timestamp
    if (age <= TASK_TTL_MS) continue

    const errorMessage = task.status === "pending"
      ? "Task timed out while queued (30 minutes)"
      : "Task timed out after 30 minutes"

    onTaskPruned(taskId, task, errorMessage)
  }

  for (const [sessionID, queued] of notifications.entries()) {
    if (queued.length === 0) {
      notifications.delete(sessionID)
      continue
    }

    const validNotifications = queued.filter((task) => {
      if (!task.startedAt) return false
      const age = now - task.startedAt.getTime()
      return age <= TASK_TTL_MS
    })

    if (validNotifications.length === 0) {
      notifications.delete(sessionID)
    } else if (validNotifications.length !== queued.length) {
      notifications.set(sessionID, validNotifications)
    }
  }
}

export async function checkAndInterruptStaleTasks(args: {
  tasks: Iterable<BackgroundTask>
  client: OpencodeClient
  config: BackgroundTaskConfig | undefined
  concurrencyManager: ConcurrencyManager
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<void> {
  const { tasks, client, config, concurrencyManager, notifyParentSession } = args
  const staleTimeoutMs = config?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS
  const now = Date.now()

  for (const task of tasks) {
    if (task.status !== "running") continue
    if (!task.progress?.lastUpdate) continue

    const startedAt = task.startedAt
    const sessionID = task.sessionID
    if (!startedAt || !sessionID) continue

    const runtime = now - startedAt.getTime()
    if (runtime < MIN_RUNTIME_BEFORE_STALE_MS) continue

    const timeSinceLastUpdate = now - task.progress.lastUpdate.getTime()
    if (timeSinceLastUpdate <= staleTimeoutMs) continue
    if (task.status !== "running") continue

    const staleMinutes = Math.round(timeSinceLastUpdate / 60000)
    task.status = "cancelled"
    task.error = `Stale timeout (no activity for ${staleMinutes}min)`
    task.completedAt = new Date()

    if (task.concurrencyKey) {
      concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    client.session.abort({
      path: { id: sessionID },
    }).catch(() => {})

    log(`[background-agent] Task ${task.id} interrupted: stale timeout`)

    try {
      await notifyParentSession(task)
    } catch (err) {
      log("[background-agent] Error in notifyParentSession for stale task:", { taskId: task.id, error: err })
    }
  }
}
