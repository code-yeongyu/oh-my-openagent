import {
  RESOLVED_MODEL_SOURCES,
  RUNNER_KINDS,
  SUSPENSION_REASONS,
  type HostSessionIdentity,
  type PendingSteeringEntry,
  type ResolvedModelRecord,
  type RunnerKind,
  type SuspensionReason,
  type TaskNotification,
  type TaskSpawnSpec,
} from "../state"
import type { DagTaskOwner } from "../dag/owner"
import {
  isRecord,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readString,
} from "./scalar-read"
import { IsolationBackendKindSchema } from "@oh-my-opencode/omo-config-core"
import type { IsolationMergeResult, IsolationRecord, TaskIsolationSpec } from "../state"

function parseIsolationSpec(value: unknown): TaskIsolationSpec {
  if (!isRecord(value)) throw new Error("isolation is not an object")
  const mode = readString(value, "mode")
  if (mode !== "patch" && mode !== "branch") throw new Error("isolation.mode must be patch or branch")
  const apply = readOptionalBoolean(value, "apply")
  if (apply === undefined) throw new Error("isolation.apply is required")
  const fellBack = readOptionalBoolean(value, "fell_back")
  return {
    backend: IsolationBackendKindSchema.parse(value["backend"]),
    ...(fellBack === undefined ? {} : { fell_back: fellBack }),
    merged_dir: readString(value, "merged_dir"),
    base_dir: readString(value, "base_dir"),
    mode,
    apply,
  }
}

export function parseOptionalIsolation(record: Record<string, unknown>): IsolationRecord | undefined {
  const value = record["isolation"]
  if (value === undefined) return undefined
  const spec = parseIsolationSpec(value)
  if (!isRecord(value)) throw new Error("isolation is not an object")
  const mergeResult = value["merge_result"]
  if (mergeResult === undefined) return spec
  if (!isRecord(mergeResult)) throw new Error("isolation.merge_result is not an object")
  const kind = readString(mergeResult, "kind")
  if (kind !== "applied" && kind !== "already-applied" && kind !== "not-applied" &&
      kind !== "branch-merged" && kind !== "branch-merge-failed" && kind !== "no-changes" && kind !== "retained") {
    throw new Error("isolation.merge_result.kind is invalid")
  }
  const changesApplied = readOptionalBoolean(mergeResult, "changesApplied")
  if (changesApplied === undefined) throw new Error("isolation.merge_result.changesApplied is required")
  const duration = readOptionalNumber(mergeResult, "duration_ms")
  const patchPath = readOptionalString(mergeResult, "patchPath")
  const error = readOptionalString(mergeResult, "error")
  const reason = readOptionalString(mergeResult, "reason")
  const summaryPath = readOptionalString(mergeResult, "summaryPath")
  const filesChanged = readOptionalNumber(mergeResult, "filesChanged")
  const nestedPatchPaths = readOptionalStringArray(mergeResult, "nestedPatchPaths")
  const branchName = readOptionalString(mergeResult, "branchName")
  const partial = readOptionalBoolean(mergeResult, "partial")
  const conflict = readOptionalString(mergeResult, "conflict")
  const manualCommand = readOptionalString(mergeResult, "manualCommand")
  const parsed: IsolationMergeResult = {
    kind,
    changesApplied,
    ...(duration === undefined ? {} : { duration_ms: duration }),
    ...(patchPath === undefined ? {} : { patchPath }),
    ...(error === undefined ? {} : { error }),
    ...(reason === undefined ? {} : { reason }),
    ...(summaryPath === undefined ? {} : { summaryPath }),
    ...(filesChanged === undefined ? {} : { filesChanged }),
    ...(nestedPatchPaths === undefined ? {} : { nestedPatchPaths }),
    ...(branchName === undefined ? {} : { branchName }),
    ...(partial === undefined ? {} : { partial }),
    ...(conflict === undefined ? {} : { conflict }),
    ...(manualCommand === undefined ? {} : { manualCommand }),
  }
  return { ...spec, merge_result: parsed }
}

// Parsers for the nested blocks of a persisted task record: ownership, spawn spec, prelaunch
// steering queue, resolved-model chain, notification epochs, host session identity, and runner kind.

function readOptionalLiteral(
  record: Record<string, unknown>,
  key: string,
  validValues: readonly string[],
): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} is not a string`)
  if (!validValues.includes(value)) throw new Error(`${key} has an invalid value: ${value}`)
  return value
}

export function readOptionalRunnerKind(
  record: Record<string, unknown>,
): RunnerKind | undefined {
  const val = readOptionalLiteral(record, "runner_kind", RUNNER_KINDS)
  return val as RunnerKind | undefined
}

export function readOptionalSuspensionReason(
  record: Record<string, unknown>,
): SuspensionReason | undefined {
  return readOptionalLiteral(record, "suspension_reason", SUSPENSION_REASONS) as SuspensionReason | undefined
}

export function parseOptionalHostSession(
  record: Record<string, unknown>,
): HostSessionIdentity | undefined {
  const value = record["host_session"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("host_session is not an object")

  const socket = readString(value, "socket")
  const routingId = readString(value, "routing_id")
  const sessionPath = readString(value, "session_path")
  const instanceId = readString(value, "instance_id")
  const daemonPid = readOptionalNumber(value, "daemon_pid")

  return {
    socket,
    routing_id: routingId,
    session_path: sessionPath,
    instance_id: instanceId,
    ...(daemonPid === undefined ? {} : { daemon_pid: daemonPid }),
  }
}

export function validateHostSessionConsistency(
  runnerKind: RunnerKind | undefined,
  hostSession: HostSessionIdentity | undefined,
): void {
  if (hostSession !== undefined && runnerKind !== "host-session") {
    throw new Error("host_session present but runner_kind is not 'host-session'")
  }
}

export function parseOptionalOwner(record: Record<string, unknown>): DagTaskOwner | undefined {
  const value = record["owner"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("owner is not an object")
  if (readString(value, "kind") !== "dag") throw new Error("owner.kind is not dag")
  return {
    kind: "dag",
    runId: readString(value, "runId") as DagTaskOwner["runId"],
    nodeId: readString(value, "nodeId") as DagTaskOwner["nodeId"],
    fingerprint: readString(value, "fingerprint"),
  }
}

export function parseOptionalSpawnSpec(record: Record<string, unknown>): TaskSpawnSpec | undefined {
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
    const isolation: TaskIsolationSpec | undefined = value["isolation"] === undefined
      ? undefined
      : parseIsolationSpec(value["isolation"])
    return {
      version: 1,
      ...(isolation === undefined ? {} : { isolation }),
      cwd,
      prompt,
      ...(instructions === undefined ? {} : { instructions }),
      ...(memberScopedToolNames === undefined ? {} : { member_scoped_tool_names: memberScopedToolNames }),
    }
  }

  // Legacy: only cwd survives; extensions/member_env are untrusted launch inputs, never persisted.
  return { cwd: readString(value, "cwd") }
}

export function parseOptionalPendingSteering(
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
    const pool = candidate["workpool"]
    if (pool !== undefined) {
      if (!isRecord(pool) || typeof pool["pool_id"] !== "string" || !/^wp_[0-9a-f]{32}$/.test(pool["pool_id"]) ||
        typeof pool["item_id"] !== "string" || pool["item_id"] !== id || !/^wi_[0-9a-f]{32}$/.test(id) ||
        typeof pool["key"] !== "string" || pool["key"].trim().length === 0 ||
        typeof pool["generation"] !== "number" || !Number.isSafeInteger(pool["generation"]) || pool["generation"] < 1 ||
        typeof pool["run_epoch"] !== "number" || !Number.isSafeInteger(pool["run_epoch"]) || pool["run_epoch"] < 0) {
        warnings?.push(`pending_steering[${index}] at ${path}: invalid workpool correlation, dropped`)
        continue
      }
      entries.push({ id, message, deliver_as: deliverAs, workpool: {
        pool_id: pool["pool_id"], item_id: pool["item_id"], key: pool["key"], generation: pool["generation"], run_epoch: pool["run_epoch"],
      } })
    } else entries.push({ id, message, deliver_as: deliverAs })
  }
  return entries
}

export function parseOptionalResolvedModel(
  record: Record<string, unknown>,
  key: "requested_model" | "resolved_model" = "resolved_model",
): ResolvedModelRecord | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${key} is not an object`)
  return readResolvedModel(value)
}

export function parseOptionalResolvedModelArray(
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

export function parseNotification(record: Record<string, unknown>): TaskNotification {
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
