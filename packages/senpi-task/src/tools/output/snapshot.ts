import { isolationDetails } from "../../isolation/details"
import type { TaskRecord } from "../../state"
import { childSessionDir } from "./transcript"
import type { LostBreadcrumbs, SuspendedDetails, TaskSnapshot } from "./types"

const LOST_EXPLANATION =
  "The task was marked lost: its process disappeared before a terminal result was recorded (crash, host restart, or an evicted resident child). Inspect the pid and session dir below; no result was captured."

const SUSPENDED_EXPLANATION = "suspended (resumes with session)"

// A daemon-hosted child that could not be reattached carries WHY on the record, so task_output tells
// the operator the difference between "waiting for its session" and "its engine daemon is gone".
const SUSPENSION_REASON_EXPLANATIONS: Readonly<Record<NonNullable<TaskRecord["suspension_reason"]>, string>> = {
  daemon_unavailable: "suspended (daemon unavailable)",
  host_draining: "suspended (host draining)",
}

const SUSPENDED_RESIDENCIES: ReadonlySet<TaskRecord["residency_state"]> = new Set(["persisted_only", "rpc_detached"])

// Record snapshot for task_output status view (pi-task task-status result fields). For a `lost` task
// it attaches read-only breadcrumbs (pid + the child's session dir) so the caller can investigate
// without task_output ever reviving or touching child state.
export function buildTaskSnapshot(record: TaskRecord, stateDir: string, now: number): TaskSnapshot {
  const isolation = isolationDetails(record)
  return {
    task_id: record.task_id,
    status: record.status,
    residency_state: record.residency_state,
    ...(isSuspended(record) ? { suspended: { explanation: suspendedExplanation(record) } } : {}),
    execution_mode: record.execution_mode,
    model: record.model,
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
    parent_session_id: record.parent_session_id,
    root_session_id: record.root_session_id,
    age_ms: ageMs(record, now),
    ...(record.name !== undefined ? { name: record.name } : {}),
    ...(record.description !== undefined ? { description: record.description } : {}),
    ...(record.task_summary !== undefined ? { task_summary: record.task_summary } : {}),
    ...(record.agent_type !== undefined ? { agent_type: record.agent_type } : {}),
    ...(record.category !== undefined ? { category: record.category } : {}),
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    ...(record.child_session_id !== undefined ? { child_session_id: record.child_session_id } : {}),
    ...(record.final_response !== undefined ? { final_response: record.final_response } : {}),
    ...(record.error_message !== undefined ? { error_message: record.error_message } : {}),
    ...(record.run_stats !== undefined ? { run_stats: record.run_stats } : {}),
    ...(isolation === undefined ? {} : { isolation }),
    ...(record.status === "lost" ? { lost: lostBreadcrumbs(record, stateDir) } : {}),
  }
}

function isSuspended(record: TaskRecord): boolean {
  return SUSPENDED_RESIDENCIES.has(record.residency_state)
}

function suspendedExplanation(record: TaskRecord): string {
  const reason = record.suspension_reason
  return reason === undefined ? SUSPENDED_EXPLANATION : SUSPENSION_REASON_EXPLANATIONS[reason]
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
