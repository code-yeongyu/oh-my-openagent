import type { BackgroundTask } from "./types"
import type { ResultHandlerContext } from "./result-handler-context"
import { log } from "../../shared"
import { notifyParentSession } from "./parent-session-notifier"

export async function tryCompleteTask(
  task: BackgroundTask,
  source: string,
  ctx: ResultHandlerContext
): Promise<boolean> {
  const { concurrencyManager, state } = ctx

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

  state.markForNotification(task)

  try {
    await notifyParentSession(task, ctx)
    log(`[background-agent] Task completed via ${source}:`, task.id)
  } catch (error) {
    log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error })
  }

  return true
}
