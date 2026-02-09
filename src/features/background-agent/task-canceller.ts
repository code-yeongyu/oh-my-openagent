import { log } from "../../shared"

import type { BackgroundTask } from "./types"
import type { LaunchInput } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

type QueueItem = { task: BackgroundTask; input: LaunchInput }

export async function cancelBackgroundTask(args: {
  taskId: string
  options?: {
    source?: string
    reason?: string
    abortSession?: boolean
    skipNotification?: boolean
  }
  tasks: Map<string, BackgroundTask>
  queuesByKey: Map<string, QueueItem[]>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  cleanupPendingByParent: (task: BackgroundTask) => void
  markForNotification: (task: BackgroundTask) => void
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<boolean> {
  const {
    taskId,
    options,
    tasks,
    queuesByKey,
    completionTimers,
    idleDeferralTimers,
    concurrencyManager,
    client,
    cleanupPendingByParent,
    markForNotification,
    notifyParentSession,
  } = args

  const task = tasks.get(taskId)
  if (!task || (task.status !== "running" && task.status !== "pending")) {
    return false
  }

  const source = options?.source ?? "cancel"
  const abortSession = options?.abortSession !== false
  const reason = options?.reason

  if (task.status === "pending") {
    const key = task.model
      ? `${task.model.providerID}/${task.model.modelID}`
      : task.agent
    const queue = queuesByKey.get(key)
    if (queue) {
      const index = queue.findIndex((item) => item.task.id === taskId)
      if (index !== -1) {
        queue.splice(index, 1)
        if (queue.length === 0) {
          queuesByKey.delete(key)
        }
      }
    }
    log("[background-agent] Cancelled pending task:", { taskId, key })
  }

  task.status = "cancelled"
  task.completedAt = new Date()
  if (reason) {
    task.error = reason
  }

  if (task.concurrencyKey) {
    concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  const completionTimer = completionTimers.get(task.id)
  if (completionTimer) {
    clearTimeout(completionTimer)
    completionTimers.delete(task.id)
  }

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

  cleanupPendingByParent(task)

  if (abortSession && task.sessionID) {
    client.session.abort({
      path: { id: task.sessionID },
    }).catch(() => {})
  }

  if (options?.skipNotification) {
    log(`[background-agent] Task cancelled via ${source} (notification skipped):`, task.id)
    return true
  }

  markForNotification(task)

  try {
    await notifyParentSession(task)
    log(`[background-agent] Task cancelled via ${source}:`, task.id)
  } catch (err) {
    log("[background-agent] Error in notifyParentSession for cancelled task:", {
      taskId: task.id,
      error: err,
    })
  }

  return true
}
