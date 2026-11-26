import { taskIdentityLabel } from "@oh-my-opencode/senpi-task"
import type { TaskRecord } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { CANCELLABLE_STATUSES, type CommandManager } from "./commands"

const STOP_REASON = "session stopped (/stop all)"

type StopItem = { readonly kind: "child"; readonly id: string; readonly label: string }
type FailedStopItem = StopItem & { readonly reason: string }

interface StopContext {
  readonly sessionManager?: { getSessionId(): string }
}

// A child the stop must end: one still running or waiting, or a finished one that still holds a resident session a
// later send would revive.
function holdsWork(record: TaskRecord): boolean {
  return CANCELLABLE_STATUSES.has(record.status) || record.residency_state === "resident"
}

function item(record: TaskRecord): StopItem {
  const label = taskIdentityLabel({
    taskId: record.task_id,
    name: record.name,
    description: record.description,
    taskSummary: record.task_summary,
  })
  return { kind: "child", id: record.task_id, label }
}

/**
 * senpi's full session stop (`/stop all`, `stop_session`; oh-my-openagent#14390) emits `session_stop`: cancel every
 * child task of this session, release the finished ones that still hold a resident session, and report each. A host
 * without the event never calls this.
 */
async function stopSessionTasks(manager: CommandManager, sessionId: string) {
  const stopped: StopItem[] = []
  const failed: FailedStopItem[] = []
  const records = manager
    .list({ scope: "parent-session", session_id: sessionId })
    .map((entry) => entry.record)
    .filter(holdsWork)
  for (const record of records) {
    try {
      const outcome = await manager.cancelTask(record.task_id, STOP_REASON)
      switch (outcome.kind) {
        case "cancelled":
        case "released":
          stopped.push(item(record))
          break
        case "cancel_pending":
          failed.push({
            ...item(record),
            reason: "its task host is unreachable; the cancel runs on the host once it is reachable",
          })
          break
        case "noop":
        case "stale":
        case "not_found":
          break
      }
    } catch (error) {
      failed.push({ ...item(record), reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return { stopped, failed }
}

export function registerTaskSessionStop(pi: SenpiExtensionAPI, manager: CommandManager): void {
  pi.on("session_stop", async (_event, ctx) => {
    const sessionId = (ctx as StopContext | undefined)?.sessionManager?.getSessionId()
    if (sessionId === undefined) return undefined
    const result = await stopSessionTasks(manager, sessionId)
    return result.stopped.length === 0 && result.failed.length === 0 ? undefined : result
  })
}
