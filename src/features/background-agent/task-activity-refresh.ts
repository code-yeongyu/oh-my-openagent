import { log } from "../../shared"
import type { SessionActivityLookup, SessionActivityResolver } from "./session-activity"
import type { BackgroundTask } from "./types"

export type TaskActivityRefreshResult =
  | { readonly type: "activity"; readonly activityTime: number }
  | { readonly type: "missing" }
  | { readonly type: "unavailable" }

function updateTaskActivityFromLookup(
  task: BackgroundTask,
  lookup: SessionActivityLookup,
): TaskActivityRefreshResult {
  if (lookup.type !== "activity") return lookup

  const activityTime = lookup.activity.getTime()
  if (!Number.isFinite(activityTime)) return { type: "missing" }

  const baseline = task.progress?.lastUpdate.getTime() ?? task.startedAt?.getTime()
  if (baseline !== undefined && activityTime <= baseline) return { type: "activity", activityTime }

  if (!task.progress) {
    task.progress = { toolCalls: 0, lastUpdate: new Date(activityTime) }
  } else {
    task.progress.lastUpdate = new Date(activityTime)
  }
  return { type: "activity", activityTime }
}

export async function refreshTaskActivityFromSession(
  task: BackgroundTask,
  getSessionActivity: SessionActivityResolver,
): Promise<TaskActivityRefreshResult> {
  if (!task.sessionId) return { type: "missing" }

  let lookup: SessionActivityLookup
  try {
    lookup = await getSessionActivity(task.sessionId)
  } catch (error) {
    if (error instanceof Error) {
      log("[background-agent] Error refreshing task session activity:", { taskId: task.id, error: error.message })
      return { type: "unavailable" }
    }
    log("[background-agent] Error refreshing task session activity:", { taskId: task.id, error })
    return { type: "unavailable" }
  }

  return updateTaskActivityFromLookup(task, lookup)
}
