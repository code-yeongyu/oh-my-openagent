import { createTaskId } from "./id"
import type { TaskRecord, TaskRecordInput } from "./types"

export function createTaskRecord(input: TaskRecordInput): TaskRecord {
  const timestamp = new Date().toISOString()
  const {
    agent_type,
    category,
    depth,
    execution_mode,
    model,
    name,
    parent_session_id,
    resolved_model,
    root_session_id,
    tool_allow,
    tool_deny,
  } = input
  return {
    task_id: createTaskId(),
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
    ...(agent_type === undefined ? {} : { agent_type }),
    ...(category === undefined ? {} : { category }),
    ...(resolved_model === undefined ? {} : { resolved_model }),
    ...(tool_allow === undefined ? {} : { tool_allow }),
    ...(tool_deny === undefined ? {} : { tool_deny }),
  }
}
