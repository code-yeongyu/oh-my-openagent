import {
  RESIDENCY_STATES,
  RESOLVED_MODEL_SOURCES,
  TASK_STATUSES,
  type PendingSteeringEntry,
  type ResolvedModelRecord,
  type TaskRecord,
  type TaskRunStats,
  type TaskSpawnSpec,
} from "../state"
import { parseTaskId } from "../state/id"

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
  const requestedModel = readOptionalResolvedModel(value, "requested_model")
  const fallbackModels = readOptionalResolvedModelArray(value, "fallback_models")
  const fallbackAttempts = readOptionalResolvedModelArray(value, "fallback_attempts")
  const resolvedModel = readOptionalResolvedModel(value, "resolved_model")
  const spawnSpec = readOptionalSpawnSpec(value)
  const pendingSteering = readOptionalPendingSteering(value, path, warnings)
  const runStats = readOptionalRunStats(value)

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
    notification: readNotification(value),
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
    ...(pendingSteering !== undefined && pendingSteering.length > 0 ? { pending_steering: pendingSteering } : {}),
    ...(pid === undefined ? {} : { pid }),
    ...(hostPid === undefined ? {} : { host_pid: hostPid }),
    ...(childSessionId === undefined ? {} : { child_session_id: childSessionId }),
    ...(finalResponse === undefined ? {} : { final_response: finalResponse }),
    ...(errorMessage === undefined ? {} : { error_message: errorMessage }),
    ...(killed === undefined ? {} : { killed }),
    ...(runStats === undefined ? {} : { run_stats: runStats }),
  }
}

function readOptionalRunStats(record: Record<string, unknown>): TaskRunStats | undefined {
  const value = record["run_stats"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("run_stats is not an object")
  const outputTokens = readOptionalNumber(value, "output_tokens")
  const totalTokens = readOptionalNumber(value, "total_tokens")
  const generationMs = readOptionalNumber(value, "generation_ms")
  const tokensPerSecond = readOptionalNumber(value, "tokens_per_second")
  const costUsd = readOptionalNumber(value, "cost_usd")
  const cacheHitRateLast = readOptionalNumber(value, "cache_hit_rate_last")
  const cacheHitRateRun = readOptionalNumber(value, "cache_hit_rate_run")
  const legacyCacheHitRate = readOptionalNumber(value, "cache_hit_rate")
  const resolvedCacheHitRateRun = cacheHitRateRun ?? legacyCacheHitRate
  return {
    runtime_ms: readNumber(value, "runtime_ms"),
    turns: readNumber(value, "turns"),
    tool_calls: readNumber(value, "tool_calls"),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    ...(totalTokens === undefined ? {} : { total_tokens: totalTokens }),
    ...(generationMs === undefined ? {} : { generation_ms: generationMs }),
    ...(tokensPerSecond === undefined ? {} : { tokens_per_second: tokensPerSecond }),
    ...(costUsd === undefined ? {} : { cost_usd: costUsd }),
    ...(cacheHitRateLast === undefined ? {} : { cache_hit_rate_last: cacheHitRateLast }),
    ...(resolvedCacheHitRateRun === undefined ? {} : { cache_hit_rate_run: resolvedCacheHitRateRun }),
  }
}

function readOptionalSpawnSpec(record: Record<string, unknown>): TaskSpawnSpec | undefined {
  const value = record["spawn_spec"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("spawn_spec is not an object")

  // v1 spec: requires version === 1 and prompt; carries cwd, instructions, member_scoped_tool_names.
  // Legacy spec: {cwd} with optional extensions/member_env that are DISCARDED as untrusted inputs.
  if (value["version"] === 1) {
    const cwd = readString(value, "cwd")
    const prompt = readString(value, "prompt")
    const instructions = readOptionalString(value, "instructions")
    const memberScopedToolNames = readOptionalStringArray(value, "member_scoped_tool_names")
    return {
      version: 1,
      cwd,
      prompt,
      ...(instructions === undefined ? {} : { instructions }),
      ...(memberScopedToolNames === undefined ? {} : { member_scoped_tool_names: memberScopedToolNames }),
    }
  }

  // Legacy: only cwd survives; extensions/member_env are untrusted launch inputs, never persisted.
  return { cwd: readString(value, "cwd") }
}

function readOptionalPendingSteering(
  record: Record<string, unknown>,
  path: string,
  warnings: string[] | undefined,
): readonly PendingSteeringEntry[] | undefined {
  const value = record["pending_steering"]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("pending_steering is not an array")

  // BINDING policy: a malformed ENTRY is dropped, siblings are kept, and the record remains valid.
  // Whole-record rejection is banned: a live child must never be orphaned over one bad steering entry.
  const entries: PendingSteeringEntry[] = []
  for (let index = 0; index < value.length; index++) {
    const candidate = value[index]
    if (!isRecord(candidate)) {
      warnings?.push(`pending_steering[${index}] at ${path}: entry is not an object, dropped`)
      continue
    }
    const id = candidate["id"]
    const message = candidate["message"]
    const deliverAs = candidate["deliver_as"]
    if (typeof id !== "string") {
      warnings?.push(`pending_steering[${index}] at ${path}: entry missing string id, dropped`)
      continue
    }
    if (typeof message !== "string") {
      warnings?.push(`pending_steering[${index}] at ${path}: entry missing string message, dropped`)
      continue
    }
    if (deliverAs !== "steer" && deliverAs !== "followUp") {
      warnings?.push(`pending_steering[${index}] at ${path}: entry has invalid deliver_as, dropped`)
      continue
    }
    entries.push({ id, message, deliver_as: deliverAs })
  }
  return entries
}

function readOptionalResolvedModel(
  record: Record<string, unknown>,
  key: "requested_model" | "resolved_model" = "resolved_model",
): ResolvedModelRecord | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${key} is not an object`)
  return readResolvedModel(value)
}

function readOptionalResolvedModelArray(
  record: Record<string, unknown>,
  key: "fallback_models" | "fallback_attempts",
): readonly ResolvedModelRecord[] | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`${key} is not an array`)
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`${key}[${index}] is not an object`)
    return readResolvedModel(candidate)
  })
}

function readResolvedModel(value: Record<string, unknown>): ResolvedModelRecord {
  const variant = readOptionalString(value, "variant")
  const legacyReasoningEffort = readOptionalString(value, "reasoning_effort")
  const reasoning = readOptionalString(value, "reasoning")
  return {
    provider: readString(value, "provider"),
    model_id: readString(value, "model_id"),
    display: readString(value, "display"),
    source: readResolvedModelSource(value),
    ...(variant === undefined ? {} : { variant }),
    ...(legacyReasoningEffort === undefined ? {} : { reasoning_effort: legacyReasoningEffort }),
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}

function readNotification(record: Record<string, unknown>): TaskRecord["notification"] {
  const notification = record["notification"]
  if (!isRecord(notification)) throw new Error("notification is not an object")
  const failedEpoch = readOptionalNumber(notification, "notification_failed_epoch")
  const livenessNotifiedEpoch = readOptionalNumber(notification, "liveness_notified_epoch")
  return {
    run_epoch: readNumber(notification, "run_epoch"),
    notified_epoch: readNumber(notification, "notified_epoch"),
    ...(failedEpoch === undefined ? {} : { notification_failed_epoch: failedEpoch }),
    ...(livenessNotifiedEpoch === undefined ? {} : { liveness_notified_epoch: livenessNotifiedEpoch }),
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
