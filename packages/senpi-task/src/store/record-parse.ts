import {
  RESIDENCY_STATES,
  RESOLVED_MODEL_SOURCES,
  TASK_STATUSES,
  type ResolvedModelRecord,
  type TaskRecord,
} from "../state"
import { parseTaskId } from "../state/id"

export function parseTaskRecord(value: unknown, path: string): TaskRecord {
  if (!isRecord(value)) throw new Error(`JSON record at ${path} is not an object`)

  const name = readOptionalString(value, "name")
  const agentType = readOptionalString(value, "agent_type")
  const category = readOptionalString(value, "category")
  const toolAllow = readOptionalStringArray(value, "tool_allow")
  const toolDeny = readOptionalStringArray(value, "tool_deny")
  const pid = readOptionalNumber(value, "pid")
  const hostPid = readOptionalNumber(value, "host_pid")
  const childSessionId = readOptionalString(value, "child_session_id")
  const finalResponse = readOptionalString(value, "final_response")
  const errorMessage = readOptionalString(value, "error_message")
  const killed = readOptionalBoolean(value, "killed")
  const resolvedModel = readOptionalResolvedModel(value)
  const spawnSpec = readOptionalSpawnSpec(value)

  return {
    task_id: parseTaskId(readString(value, "task_id")),
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
    ...(name === undefined ? {} : { name }),
    ...(agentType === undefined ? {} : { agent_type: agentType }),
    ...(category === undefined ? {} : { category }),
    ...(toolAllow === undefined ? {} : { tool_allow: toolAllow }),
    ...(toolDeny === undefined ? {} : { tool_deny: toolDeny }),
    ...(resolvedModel === undefined ? {} : { resolved_model: resolvedModel }),
    ...(spawnSpec === undefined ? {} : { spawn_spec: spawnSpec }),
    ...(pid === undefined ? {} : { pid }),
    ...(hostPid === undefined ? {} : { host_pid: hostPid }),
    ...(childSessionId === undefined ? {} : { child_session_id: childSessionId }),
    ...(finalResponse === undefined ? {} : { final_response: finalResponse }),
    ...(errorMessage === undefined ? {} : { error_message: errorMessage }),
    ...(killed === undefined ? {} : { killed }),
  }
}

function readOptionalSpawnSpec(record: Record<string, unknown>): TaskRecord["spawn_spec"] {
  const value = record["spawn_spec"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("spawn_spec is not an object")
  return { cwd: readString(value, "cwd") }
}

function readOptionalResolvedModel(record: Record<string, unknown>): ResolvedModelRecord | undefined {
  const value = record["resolved_model"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("resolved_model is not an object")
  const variant = readOptionalString(value, "variant")
  const reasoningEffort = readOptionalString(value, "reasoning_effort")
  return {
    provider: readString(value, "provider"),
    model_id: readString(value, "model_id"),
    display: readString(value, "display"),
    source: readResolvedModelSource(value),
    ...(variant === undefined ? {} : { variant }),
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
  }
}

function readNotification(record: Record<string, unknown>): TaskRecord["notification"] {
  const notification = record["notification"]
  if (!isRecord(notification)) throw new Error("notification is not an object")
  const failedEpoch = readOptionalNumber(notification, "notification_failed_epoch")
  return {
    run_epoch: readNumber(notification, "run_epoch"),
    notified_epoch: readNumber(notification, "notified_epoch"),
    ...(failedEpoch === undefined ? {} : { notification_failed_epoch: failedEpoch }),
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
      throw new Error(`Invalid task status [REDACTED]; expected one of ${TASK_STATUSES.join(", ")}`)
  }
}

function readResolvedModelSource(record: Record<string, unknown>): ResolvedModelRecord["source"] {
  const source = readString(record, "source")
  switch (source) {
    case "category":
    case "explicit":
    case "agent":
      return source
    default:
      throw new Error(`resolved_model.source must be ${RESOLVED_MODEL_SOURCES.join(" or ")}`)
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
      throw new Error(`Invalid residency state [REDACTED]; expected one of ${RESIDENCY_STATES.join(", ")}`)
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

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  return value
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "number") throw new Error(`${key} is not a number`)
  return value
}

function readOptionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${key} is not a boolean`)
  return value
}

function readOptionalStringArray(record: Record<string, unknown>, key: string): readonly string[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${key} is not a string array`)
  }
  return value
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
