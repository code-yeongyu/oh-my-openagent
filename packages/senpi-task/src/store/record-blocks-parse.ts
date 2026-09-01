import {
  RESOLVED_MODEL_SOURCES,
  type PendingSteeringEntry,
  type ResolvedModelRecord,
  type TaskNotification,
  type TaskSpawnSpec,
} from "../state"
import type { DagTaskOwner } from "../dag/owner"
import {
  isRecord,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readOptionalStringArray,
  readString,
} from "./scalar-read"

// Parsers for the nested blocks of a persisted task record: ownership, spawn spec, prelaunch
// steering queue, resolved-model chain, and notification epochs.

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
    entries.push({ id, message, deliver_as: deliverAs })
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
