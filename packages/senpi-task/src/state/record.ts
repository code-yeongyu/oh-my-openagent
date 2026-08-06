import { createTaskId } from "./id"
import type { TaskRecord, TaskRecordInput } from "./types"

export function createTaskRecord(input: TaskRecordInput, nowMs?: number): TaskRecord {
  const timestamp = new Date().toISOString()
  const {
    agent_type,
    category,
    depth,
    description,
    execution_mode,
    fallback_models,
    model,
    name,
    parent_session_id,
    requested_model,
    fallback_attempts,
    resolved_model,
    root_session_id,
    task_summary,
    tool_allow,
    tool_deny,
    notify_on_terminal,
    pending_steering,
  } = input
  return {
    task_id: nowMs === undefined ? createTaskId() : createTaskId(nowMs),
    status: "pending",
    residency_state: "resident",
    parent_session_id,
    root_session_id,
    depth,
    execution_mode,
    model,
    notify_on_terminal,
    created_at: timestamp,
    updated_at: timestamp,
    notification: {
      run_epoch: 0,
      notified_epoch: -1,
    },
    ...(name === undefined ? {} : { name }),
    ...(task_summary === undefined ? {} : { task_summary }),
    ...(description === undefined ? {} : { description }),
    ...(agent_type === undefined ? {} : { agent_type }),
    ...(category === undefined ? {} : { category }),
    ...(requested_model === undefined ? {} : { requested_model }),
    ...(fallback_models === undefined ? {} : { fallback_models }),
    ...(fallback_attempts === undefined ? {} : { fallback_attempts }),
    ...(resolved_model === undefined ? {} : { resolved_model }),
    ...(tool_allow === undefined ? {} : { tool_allow }),
    ...(tool_deny === undefined ? {} : { tool_deny }),
    ...(pending_steering === undefined || pending_steering.length === 0 ? {} : { pending_steering }),
  }
}
