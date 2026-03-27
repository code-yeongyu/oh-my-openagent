import { log } from "../../shared"

import type { BackgroundTaskConfig } from "../../config/schema"
import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

import {
  DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS,
  DEFAULT_SESSION_GONE_TIMEOUT_MS,
  DEFAULT_STALE_TIMEOUT_MS,
  MIN_RUNTIME_BEFORE_STALE_MS,
  TERMINAL_TASK_TTL_MS,
  TASK_TTL_MS,
} from "./constants"
import { removeTaskToastTracking } from "./remove-task-toast-tracking"

import { isActiveSessionStatus } from "./session-status-classifier"
const TERMINAL_TASK_STATUSES = new Set<BackgroundTask["status"]>([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

export function pruneStaleTasksAndNotifications(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  onTaskPruned: (taskId: string, task: BackgroundTask, errorMessage: string) => void
  taskTtlMs?: number
}): void {
  const { tasks, notifications, onTaskPruned } = args
  const effectiveTtl = args.taskTtlMs ?? TASK_TTL_MS
  const now = Date.now()
  const tasksWithPendingNotifications = new Set<string>()

  for (const queued of notifications.values()) {
    for (const task of queued) {
      tasksWithPendingNotifications.add(task.id)
    }
  }

  for (const [taskId, task] of tasks.entries()) {
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      if (tasksWithPendingNotifications.has(taskId)) continue

      const completedAt = task.completedAt?.getTime()
      if (!completedAt) continue

      const age = now - completedAt
      if (age <= TERMINAL_TASK_TTL_MS) continue

      removeTaskToastTracking(taskId)
      tasks.delete(taskId)
      continue
    }

    const lastActivity = task.status === "running" && task.progress?.lastUpdate
      ? task.progress.lastUpdate.getTime()
      : undefined
    const timestamp = task.status === "pending"
      ? task.queuedAt?.getTime()
      : (lastActivity ?? task.startedAt?.getTime())

    if (!timestamp) continue

    const age = now - timestamp
    if (age <= effectiveTtl) continue

    const ttlMinutes = Math.round(effectiveTtl / 60000)
    const errorMessage = task.status === "pending"
      ? `Task timed out while queued (${ttlMinutes} minutes)`
      : `Task timed out after ${ttlMinutes} minutes of inactivity`

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
      return age <= effectiveTtl
    })

    if (validNotifications.length === 0) {
      notifications.delete(sessionID)
    } else if (validNotifications.length !== queued.length) {
      notifications.set(sessionID, validNotifications)
    }
  }
}

export type SessionStatusMap = Record<string, { type: string }>

export async function checkAndInterruptStaleTasks(args: {
  tasks: Iterable<BackgroundTask>
  client: OpencodeClient
  config: BackgroundTaskConfig | undefined
  concurrencyManager: ConcurrencyManager
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  sessionStatuses?: SessionStatusMap
  onTaskInterrupted?: (task: BackgroundTask) => void
}): Promise<void> {
  const {
    tasks,
    client,
    config,
    concurrencyManager,
    notifyParentSession,
    sessionStatuses,
    onTaskInterrupted = (task) => removeTaskToastTracking(task.id),
  } = args
  const staleTimeoutMs = config?.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS
  const sessionGoneTimeoutMs = config?.sessionGoneTimeoutMs ?? DEFAULT_SESSION_GONE_TIMEOUT_MS
  const now = Date.now()

  const messageStalenessMs = config?.messageStalenessTimeoutMs ?? DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS

  for (const task of tasks) {
    if (task.status !== "running") continue

    const startedAt = task.startedAt
    const sessionID = task.sessionID
    if (!startedAt || !sessionID) continue

    const sessionStatus = sessionStatuses?.[sessionID]?.type
    const sessionIsRunning = sessionStatus !== undefined && isActiveSessionStatus(sessionStatus)
    const sessionGone = sessionStatuses !== undefined && sessionStatus === undefined
    const runtime = now - startedAt.getTime()

    if (!task.progress?.lastUpdate) {
      if (sessionIsRunning) continue
      const effectiveTimeout = sessionGone ? sessionGoneTimeoutMs : messageStalenessMs
      if (runtime <= effectiveTimeout) continue

      const staleMinutes = Math.round(runtime / 60000)
      const reason = sessionGone ? "session gone from status registry" : "no activity"
      task.status = "cancelled"
      task.error = `Stale timeout (${reason} for ${staleMinutes}min since start). This is a FINAL cancellation - do NOT create a replacement task. If the timeout is too short, increase 'background_task.${sessionGone ? "sessionGoneTimeoutMs" : "staleTimeoutMs"}' in .opencode/oh-my-opencode.json.`
      task.completedAt = new Date()

      if (task.concurrencyKey) {
        concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      onTaskInterrupted(task)

      client.session.abort({ path: { id: sessionID } }).catch(() => {})
      log(`[background-agent] Task ${task.id} interrupted: no progress since start`)

      try {
        await notifyParentSession(task)
      } catch (err) {
        log("[background-agent] Error in notifyParentSession for stale task:", { taskId: task.id, error: err })
      }
      continue
    }

    if (sessionIsRunning) continue

    if (runtime < MIN_RUNTIME_BEFORE_STALE_MS) continue

    const timeSinceLastUpdate = now - task.progress.lastUpdate.getTime()
    const effectiveStaleTimeout = sessionGone ? sessionGoneTimeoutMs : staleTimeoutMs
    if (timeSinceLastUpdate <= effectiveStaleTimeout) continue
    if (task.status !== "running") continue

     const staleMinutes = Math.round(timeSinceLastUpdate / 60000)
     const reason = sessionGone ? "session gone from status registry" : "no activity"
     task.status = "cancelled"
     task.error = `Stale timeout (${reason} for ${staleMinutes}min). This is a FINAL cancellation - do NOT create a replacement task. If the timeout is too short, increase 'background_task.${sessionGone ? "sessionGoneTimeoutMs" : "staleTimeoutMs"}' in .opencode/oh-my-opencode.json.`
     task.completedAt = new Date()

    if (task.concurrencyKey) {
      concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    onTaskInterrupted(task)

    client.session.abort({ path: { id: sessionID } }).catch(() => {})
    log(`[background-agent] Task ${task.id} interrupted: stale timeout`)

    try {
      await notifyParentSession(task)
    } catch (err) {
      log("[background-agent] Error in notifyParentSession for stale task:", { taskId: task.id, error: err })
    }
  }
}
