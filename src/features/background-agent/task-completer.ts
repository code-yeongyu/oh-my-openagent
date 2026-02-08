import { log } from "../../shared"

import type { BackgroundTask } from "./types"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./opencode-client"

export async function tryCompleteBackgroundTask(args: {
  task: BackgroundTask
  source: string
  concurrencyManager: ConcurrencyManager
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  client: OpencodeClient
  markForNotification: (task: BackgroundTask) => void
  cleanupPendingByParent: (task: BackgroundTask) => void
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<boolean> {
  const {
    task,
    source,
    concurrencyManager,
    idleDeferralTimers,
    client,
    markForNotification,
    cleanupPendingByParent,
    notifyParentSession,
  } = args

  if (task.status !== "running") {
    log("[background-agent] Task already completed, skipping:", {
      taskId: task.id,
      status: task.status,
      source,
    })
    return false
  }

  task.status = "completed"
  task.completedAt = new Date()

  if (task.concurrencyKey) {
    concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  markForNotification(task)
  cleanupPendingByParent(task)

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

  if (task.sessionID) {
    client.session.abort({
      path: { id: task.sessionID },
    }).catch(() => {})
  }

  try {
    await notifyParentSession(task)
    log(`[background-agent] Task completed via ${source}:`, task.id)
  } catch (err) {
    log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error: err })
  }

  return true
}
