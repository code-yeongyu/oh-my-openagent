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
    tool_allow,
    tool_deny,
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
    created_at: timestamp,
    updated_at: timestamp,
    notification: {
      run_epoch: 0,
      notified_epoch: -1,
    },
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(agent_type === undefined ? {} : { agent_type }),
    ...(category === undefined ? {} : { category }),
    ...(requested_model === undefined ? {} : { requested_model }),
    ...(fallback_models === undefined ? {} : { fallback_models }),
    ...(fallback_attempts === undefined ? {} : { fallback_attempts }),
    ...(resolved_model === undefined ? {} : { resolved_model }),
    ...(tool_allow === undefined ? {} : { tool_allow }),
    ...(tool_deny === undefined ? {} : { tool_deny }),
  }
}
