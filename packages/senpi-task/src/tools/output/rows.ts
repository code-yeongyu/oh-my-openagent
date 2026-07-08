import type { ListedTask } from "../../manager"
import type { TaskRecord, TaskStatus } from "../../state"
import { isTerminalStatus } from "../control"
import type { TaskListRow } from "./types"

// running first, then pending, then every terminal state. Within a rank, most-recently-updated wins
// (codex list_agents + pi-task /tasks recency semantics).
function statusRank(status: TaskStatus): number {
  if (status === "running") return 0
  if (status === "pending") return 1
  return 2
}

function ageMs(record: TaskRecord, now: number): number {
  const created = Date.parse(record.created_at)
  return Number.isNaN(created) ? 0 : Math.max(0, now - created)
}

// A terminal task whose completion epoch has not been acknowledged: the parent has an unread result.
function unreadNotification(record: TaskRecord): boolean {
  return isTerminalStatus(record.status) && record.notification.notified_epoch < record.notification.run_epoch
}

function toRow(listed: ListedTask, now: number): TaskListRow {
  const record = listed.record
  return {
    task_id: record.task_id,
    status: record.status,
    execution_mode: record.execution_mode,
    model: record.model,
    age_ms: ageMs(record, now),
    unread_notification: unreadNotification(record),
    ...(record.name !== undefined ? { name: record.name } : {}),
    ...(record.agent_type !== undefined ? { agent_type: record.agent_type } : {}),
    ...(record.category !== undefined ? { category: record.category } : {}),
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    ...(listed.queue_position !== undefined ? { queue_position: listed.queue_position } : {}),
  }
}

export function buildTaskListRows(listed: readonly ListedTask[], now: number): readonly TaskListRow[] {
  return listed
    .map((entry) => ({ entry, updated: Date.parse(entry.record.updated_at) }))
    .toSorted((a, b) => {
      const rank = statusRank(a.entry.record.status) - statusRank(b.entry.record.status)
      if (rank !== 0) return rank
      return recencyValue(b.updated) - recencyValue(a.updated)
    })
    .map(({ entry }) => toRow(entry, now))
}

function recencyValue(parsed: number): number {
  return Number.isNaN(parsed) ? 0 : parsed
}
