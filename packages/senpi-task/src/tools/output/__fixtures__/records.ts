import type { TaskRecord, TaskStatus } from "../../../state"

export type RecordOverrides = {
  readonly task_id?: string
  readonly name?: string
  readonly status?: TaskStatus
  readonly parent_session_id?: string
  readonly execution_mode?: string
  readonly model?: string
  readonly agent_type?: string
  readonly category?: string
  readonly pid?: number
  readonly child_session_id?: string
  readonly created_at?: string
  readonly updated_at?: string
  readonly final_response?: string
  readonly error_message?: string
  readonly run_epoch?: number
  readonly notified_epoch?: number
}

// A fully-formed TaskRecord for tool tests: every required field defaulted, terminal fields opt-in.
export function makeRecord(overrides: RecordOverrides = {}): TaskRecord {
  const status = overrides.status ?? "running"
  const timestamp = overrides.updated_at ?? "2024-12-03T14:00:00.000Z"
  return {
    task_id: overrides.task_id ?? "st_0000000000000000",
    parent_session_id: overrides.parent_session_id ?? "session-parent",
    root_session_id: "session-root",
    depth: 0,
    status,
    residency_state: "resident",
    execution_mode: overrides.execution_mode ?? "in-process",
    model: overrides.model ?? "claude-sonnet-4-5",
    created_at: overrides.created_at ?? timestamp,
    updated_at: timestamp,
    notification: {
      run_epoch: overrides.run_epoch ?? 0,
      notified_epoch: overrides.notified_epoch ?? -1,
    },
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.agent_type !== undefined ? { agent_type: overrides.agent_type } : {}),
    ...(overrides.category !== undefined ? { category: overrides.category } : {}),
    ...(overrides.pid !== undefined ? { pid: overrides.pid } : {}),
    ...(overrides.child_session_id !== undefined ? { child_session_id: overrides.child_session_id } : {}),
    ...(overrides.final_response !== undefined ? { final_response: overrides.final_response } : {}),
    ...(overrides.error_message !== undefined ? { error_message: overrides.error_message } : {}),
  }
}
