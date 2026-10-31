import { log } from "@oh-my-opencode/utils/logger"

import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { describeRecordError, TaskRecordWriteError } from "../store/record-error"

export function spawnFailureMessage(error: unknown): string {
  const kind = error instanceof TaskRecordWriteError ? "spawn bookkeeping failed" : "unexpected spawn transition failure"
  return `${kind}: ${describeRecordError(error)}`
}

export function recordSpawnFailure(store: TaskRecordStore, record: TaskRecord, error: unknown): TaskRecord | null {
  const message = spawnFailureMessage(error)
  log("senpi-task spawn persistence failed", { taskId: record.task_id, error: message })
  // Unexpected errors are explicitly distinguished, not relabelled as Windows bookkeeping.
  return store.markSpawnFailed(record, message)
}

export function persistSpawnRefusal(
  store: TaskRecordStore,
  record: TaskRecord,
  timestamp: string,
  message: string,
  cause?: unknown,
): string {
  try {
    const started = store.transition(record.task_id, { type: "start", timestamp })
    if (!started.applied) throw new Error("spawn bookkeeping failure transitions were not applied")
    const failed = store.transition(record.task_id, { type: "fail", timestamp, error_message: message })
    if (!failed.applied) throw new Error("spawn bookkeeping failure transitions were not applied")
  } catch (error) {
    recordSpawnFailure(store, record, error)
    return spawnFailureMessage(error)
  }
  if (cause !== undefined) log("senpi-task spawn persistence failed", { taskId: record.task_id, error: message })
  return message
}
