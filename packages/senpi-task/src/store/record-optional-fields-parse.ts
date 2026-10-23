import { BACKGROUND_MODES, type BackgroundMode, type TaskRecord } from "../state"
import { AWAITING_INPUT_REASONS } from "../state/types"
import { parseOptionalHostSession } from "./record-blocks-parse"
import { isRecord, readNumber, readOptionalBoolean, readOptionalNumber, readOptionalString, readString } from "./scalar-read"

// The optional run-lifecycle blocks of a task record: each parser returns undefined for an absent
// field and throws on a malformed one, like the rest of record-parse.ts.

export function parseOptionalAwaitingInput(record: Record<string, unknown>): TaskRecord["awaiting_input"] {
  const value = record["awaiting_input"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("awaiting_input is not an object")
  const reason = readString(value, "reason")
  if (!(AWAITING_INPUT_REASONS as readonly string[]).includes(reason)) throw new Error(`awaiting_input.reason is not a known reason: ${reason}`)
  return { reason: reason as NonNullable<TaskRecord["awaiting_input"]>['reason'], since: readString(value, "since") }
}

export function parseOptionalCancelRequest(record: Record<string, unknown>): TaskRecord["cancel_requested"] {
  const value = record["cancel_requested"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("cancel_requested is not an object")
  const reason = readOptionalString(value, "reason")
  return { requested_at: readString(value, "requested_at"), ...(reason === undefined ? {} : { reason }) }
}

export function parseOptionalClosingChild(record: Record<string, unknown>): TaskRecord["fallback_closing_child"] {
  const value = record["fallback_closing_child"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("fallback_closing_child is not an object")
  const pid = readOptionalNumber(value, "pid")
  const hostSession = parseOptionalHostSession(value)
  const confirmation = readOptionalBoolean(value, "requires_confirmation")
  return {
    ...(pid === undefined ? {} : { pid }),
    ...(hostSession === undefined ? {} : { host_session: hostSession }),
    ...(confirmation === undefined ? {} : { requires_confirmation: confirmation }),
  }
}

export function parseOptionalStartQueued(record: Record<string, unknown>): TaskRecord["start_queued"] {
  const value = record["start_queued"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("start_queued is not an object")
  return {
    model: readString(value, "model"),
    queued_at: readString(value, "queued_at"),
    queue_position: readNumber(value, "queue_position"),
  }
}

export function parseOptionalReviveDeliveryUncertainty(record: Record<string, unknown>): TaskRecord["revive_delivery_uncertain"] {
  const value = record["revive_delivery_uncertain"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("revive_delivery_uncertain is not an object")
  return {
    run_epoch: readNumber(value, "run_epoch"),
    message_sha256: readString(value, "message_sha256"),
  }
}

export function readOptionalBackgroundMode(record: Record<string, unknown>): BackgroundMode | undefined {
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

// A negative or non-finite figure is not a spend: it is rejected like any malformed field.
export function readOptionalPriorRunsCost(record: Record<string, unknown>): number | undefined {
  const value = readOptionalNumber(record, "prior_runs_cost_usd")
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("prior_runs_cost_usd must be a finite non-negative number")
  return value
}
