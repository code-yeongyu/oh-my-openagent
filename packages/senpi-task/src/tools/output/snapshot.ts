import { isolationDetails } from "../../isolation/details"
import { isTerminalRecord } from "../../manager/manager-helpers"
import type { AwaitingInputReason, TaskRecord } from "../../state"
import { recoveryPresentation } from "../../state/recovery-presentation"
import { childSessionDir } from "./transcript"
import type { AwaitingInputDetails, LostBreadcrumbs, TaskSnapshot } from "./types"

const LOST_EXPLANATION =
  "The task was marked lost: its process disappeared before a terminal result was recorded (crash, host restart, or an evicted resident child). Inspect the pid and session dir below; no result was captured."

const AWAITING_INPUT_CAUSES: Readonly<Record<AwaitingInputReason, string>> = {
  resumed_turn_aborted: "its resumed session's last turn ended on an abort",
  resumed_turn_unfinished: "its resumed session's last turn stopped before finishing (an error, a pending tool call, or an unanswered prompt)",
}

// The user-facing flag text (senpi#3266): why the child cannot continue on its own, and the two
// one-step actions out of the state.
function awaitingInputExplanation(reason: AwaitingInputReason): string {
  return `resumed, waiting for input: ${AWAITING_INPUT_CAUSES[reason]}, so it cannot continue on its own. Cancel it (task_cancel) or re-dispatch it onto a live session (task_send with redispatch:true replays its persisted prompt).`
}

// The one projection of the flag every status surface shows (task_output, the RPC task snapshot): a
// terminal record never reads as waiting, whatever stale flag it still carries.
export function awaitingInputDetails(record: TaskRecord): AwaitingInputDetails | undefined {
  if (record.awaiting_input === undefined || isTerminalRecord(record)) return undefined
  return { reason: record.awaiting_input.reason, explanation: awaitingInputExplanation(record.awaiting_input.reason) }
}

// Record snapshot for task_output status view (pi-task task-status result fields). For a `lost` task
// it attaches read-only breadcrumbs (pid + the child's session dir) so the caller can investigate
// without task_output ever reviving or touching child state.
export function buildTaskSnapshot(record: TaskRecord, stateDir: string, now: number): TaskSnapshot {
  const isolation = isolationDetails(record)
  const recovery = recoveryPresentation(record)
  const awaitingInput = awaitingInputDetails(record)
  return {
    task_id: record.task_id,
    status: record.status,
    residency_state: record.residency_state,
    ...(recovery === undefined ? {} : { suspended: { explanation: recovery.text } }),
    ...(awaitingInput === undefined ? {} : { awaiting_input: awaitingInput }),
    ...(record.status === "running" && record.start_queued !== undefined ? { start_queued: record.start_queued } : {}),
    execution_mode: record.execution_mode,
    model: record.model,
    ...(record.resolved_model !== undefined ? { resolved_model: record.resolved_model } : {}),
    ...(record.effective_model !== undefined ? { effective_model: record.effective_model } : {}),
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
    ...(record.last_seen_at === undefined ? {} : { last_seen_at: record.last_seen_at }),
    ...(record.final_response !== undefined ? { final_response: record.final_response } : {}),
    ...(record.error_message !== undefined ? { error_message: record.error_message } : {}),
    ...(record.run_stats !== undefined ? { run_stats: record.run_stats } : {}),
    ...(isolation === undefined ? {} : { isolation }),
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
