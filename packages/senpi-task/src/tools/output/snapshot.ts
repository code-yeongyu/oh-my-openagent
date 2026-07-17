import type { TaskRecord } from "../../state"
import { childSessionDir } from "./transcript"
import type { LostBreadcrumbs, TaskSnapshot } from "./types"

const LOST_EXPLANATION =
  "The task was marked lost: its process disappeared before a terminal result was recorded (crash, host restart, or an evicted resident child). Inspect the pid and session dir below; no result was captured."

// Record snapshot for task_output status view (pi-task task-status result fields). For a `lost` task
// it attaches read-only breadcrumbs (pid + the child's session dir) so the caller can investigate
// without task_output ever reviving or touching child state.
export function buildTaskSnapshot(record: TaskRecord, stateDir: string, now: number): TaskSnapshot {
  return {
    task_id: record.task_id,
    status: record.status,
    execution_mode: record.execution_mode,
    model: record.model,
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
    parent_session_id: record.parent_session_id,
    root_session_id: record.root_session_id,
    age_ms: ageMs(record, now),
    ...(record.name !== undefined ? { name: record.name } : {}),
    ...(record.agent_type !== undefined ? { agent_type: record.agent_type } : {}),
    ...(record.category !== undefined ? { category: record.category } : {}),
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    ...(record.child_session_id !== undefined ? { child_session_id: record.child_session_id } : {}),
    ...(record.final_response !== undefined ? { final_response: record.final_response } : {}),
    ...(record.error_message !== undefined ? { error_message: record.error_message } : {}),
    ...(record.status === "lost" ? { lost: lostBreadcrumbs(record, stateDir) } : {}),
  }
}

function lostBreadcrumbs(record: TaskRecord, stateDir: string): LostBreadcrumbs {
  return {
    explanation: LOST_EXPLANATION,
    session_dir: childSessionDir(stateDir, record.task_id),
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
  }
}

function ageMs(record: TaskRecord, now: number): number {
  const created = Date.parse(record.created_at)
  return Number.isNaN(created) ? 0 : Math.max(0, now - created)
}
