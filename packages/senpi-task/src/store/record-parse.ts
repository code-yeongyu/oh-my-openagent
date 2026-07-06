import { RESIDENCY_STATES, TASK_STATUSES, type TaskRecord } from "../state"

export function parseTaskRecord(value: unknown, path: string): TaskRecord {
  if (!isRecord(value)) throw new Error(`JSON record at ${path} is not an object`)

  const record = {
    ...value,
    task_id: readString(value, "task_id"),
    status: readTaskStatus(value),
    residency_state: readResidencyState(value),
    parent_session_id: readString(value, "parent_session_id"),
    root_session_id: readString(value, "root_session_id"),
    depth: readNumber(value, "depth"),
    execution_mode: readString(value, "execution_mode"),
    model: readString(value, "model"),
    created_at: readString(value, "created_at"),
    updated_at: readString(value, "updated_at"),
    notification: readNotification(value),
  }
  return record
}

function readNotification(record: Record<string, unknown>): TaskRecord["notification"] {
  const notification = record["notification"]
  if (!isRecord(notification)) throw new Error("notification is not an object")
  const failedEpoch = notification["notification_failed_epoch"]
  return {
    run_epoch: readNumber(notification, "run_epoch"),
    notified_epoch: readNumber(notification, "notified_epoch"),
    ...(typeof failedEpoch === "number" ? { notification_failed_epoch: failedEpoch } : {}),
  }
}

function readTaskStatus(record: Record<string, unknown>): TaskRecord["status"] {
  const status = readString(record, "status")
  switch (status) {
    case "pending":
    case "running":
    case "completed":
    case "error":
    case "cancelled":
    case "interrupted":
    case "lost":
      return status
    default:
      throw new Error(`Invalid task status ${status}; expected one of ${TASK_STATUSES.join(", ")}`)
  }
}

function readResidencyState(record: Record<string, unknown>): TaskRecord["residency_state"] {
  const residencyState = readString(record, "residency_state")
  switch (residencyState) {
    case "resident":
    case "evicted":
    case "disposed":
    case "persisted_only":
    case "rpc_detached":
      return residencyState
    default:
      throw new Error(`Invalid residency state ${residencyState}; expected one of ${RESIDENCY_STATES.join(", ")}`)
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number") throw new Error(`${key} is not a number`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
