import {
  BACKGROUND_MODES,
  RESIDENCY_STATES,
  TASK_STATUSES,
  type BackgroundMode,
  type TaskRecord,
} from "../state"
import { parseTaskId } from "../state/id"
import {
  parseNotification,
  parseOptionalOwner,
  parseOptionalPendingSteering,
  parseOptionalResolvedModel,
  parseOptionalResolvedModelArray,
  parseOptionalSpawnSpec,
} from "./record-blocks-parse"
import { parseRunStats } from "./run-stats-parse"
import {
  isRecord,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readString,
} from "./scalar-read"

export function parseTaskRecord(value: unknown, path: string, warnings?: string[]): TaskRecord {
  if (!isRecord(value)) throw new Error(`JSON record at ${path} is not an object`)

  const name = readOptionalString(value, "name")
  const taskSummary = readOptionalString(value, "task_summary")
  const description = readOptionalString(value, "description")
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
  // Legacy records predate the field: they never asked for a terminal notification, so false.
  const notifyOnTerminal = readOptionalBoolean(value, "notify_on_terminal") ?? false
  const requestedModel = parseOptionalResolvedModel(value, "requested_model")
  const fallbackModels = parseOptionalResolvedModelArray(value, "fallback_models")
  const fallbackAttempts = parseOptionalResolvedModelArray(value, "fallback_attempts")
  const resolvedModel = parseOptionalResolvedModel(value, "resolved_model")
  const spawnSpec = parseOptionalSpawnSpec(value)
  const owner = parseOptionalOwner(value)
  const pendingSteering = parseOptionalPendingSteering(value, path, warnings)
  const runStats = value["run_stats"] === undefined ? undefined : parseRunStats(value["run_stats"])
  const taskSeq = readOptionalNumber(value, "task_seq")
  const configGeneration = readOptionalNumber(value, "config_generation")
  const backgroundMode = readOptionalBackgroundMode(value)

  return {
    task_id: parseTaskId(readString(value, "task_id")),
    status: readTaskStatus(value),
    residency_state: readResidencyState(value),
    parent_session_id: readString(value, "parent_session_id"),
    root_session_id: readString(value, "root_session_id"),
    depth: readNumber(value, "depth"),
    execution_mode: readString(value, "execution_mode"),
    model: readString(value, "model"),
    notify_on_terminal: notifyOnTerminal,
    created_at: readString(value, "created_at"),
    updated_at: readString(value, "updated_at"),
    notification: parseNotification(value),
    ...(name === undefined ? {} : { name }),
    ...(taskSummary === undefined ? {} : { task_summary: taskSummary }),
    ...(description === undefined ? {} : { description }),
    ...(agentType === undefined ? {} : { agent_type: agentType }),
    ...(category === undefined ? {} : { category }),
    ...(toolAllow === undefined ? {} : { tool_allow: toolAllow }),
    ...(toolDeny === undefined ? {} : { tool_deny: toolDeny }),
    ...(requestedModel === undefined ? {} : { requested_model: requestedModel }),
    ...(fallbackModels === undefined ? {} : { fallback_models: fallbackModels }),
    ...(fallbackAttempts === undefined ? {} : { fallback_attempts: fallbackAttempts }),
    ...(resolvedModel === undefined ? {} : { resolved_model: resolvedModel }),
    ...(spawnSpec === undefined ? {} : { spawn_spec: spawnSpec }),
    ...(owner === undefined ? {} : { owner }),
    ...(pendingSteering !== undefined && pendingSteering.length > 0 ? { pending_steering: pendingSteering } : {}),
    ...(pid === undefined ? {} : { pid }),
    ...(hostPid === undefined ? {} : { host_pid: hostPid }),
    ...(childSessionId === undefined ? {} : { child_session_id: childSessionId }),
    ...(finalResponse === undefined ? {} : { final_response: finalResponse }),
    ...(errorMessage === undefined ? {} : { error_message: errorMessage }),
    ...(killed === undefined ? {} : { killed }),
    ...(runStats === undefined ? {} : { run_stats: runStats }),
    ...(taskSeq === undefined ? {} : { task_seq: taskSeq }),
    ...(configGeneration === undefined ? {} : { config_generation: configGeneration }),
    ...(backgroundMode === undefined ? {} : { background_mode: backgroundMode }),
  }
}

function readOptionalBackgroundMode(record: Record<string, unknown>): BackgroundMode | undefined {
  const mode = readOptionalString(record, "background_mode")
  if (mode === undefined) return undefined
  switch (mode) {
    case "foreground":
    case "background":
    case "promoted":
      return mode
    default:
      throw new Error(`background_mode must be one of ${BACKGROUND_MODES.join(", ")}`)
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
