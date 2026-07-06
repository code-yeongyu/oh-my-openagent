import { createTaskId } from "./id"
import type { TaskRecord, TaskRecordInput } from "./types"

export function createTaskRecord(input: TaskRecordInput): TaskRecord {
  const timestamp = new Date().toISOString()
  return {
    ...input,
    task_id: createTaskId(),
    status: "pending",
    residency_state: "resident",
    created_at: timestamp,
    updated_at: timestamp,
    notification: {
      run_epoch: 0,
      notified_epoch: -1,
    },
  }
}
