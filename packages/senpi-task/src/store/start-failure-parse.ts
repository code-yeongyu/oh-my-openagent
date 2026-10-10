import {
  isTaskStartFailureKind,
  isTaskStartFailureReason,
  type TaskStartFailureKind,
  type TaskStartFailureReason,
} from "../state"

export function readOptionalTaskStartFailureKind(
  record: Record<string, unknown>,
): TaskStartFailureKind | undefined {
  const value = record["failure_kind"]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error("failure_kind is not a string")
  if (!isTaskStartFailureKind(value)) throw new Error("failure_kind has an invalid value")
  return value
}

export function readOptionalTaskStartFailureReason(
  record: Record<string, unknown>,
): TaskStartFailureReason | undefined {
  const value = record["failure_reason"]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error("failure_reason is not a string")
  if (!isTaskStartFailureReason(value)) throw new Error("failure_reason has an invalid value")
  return value
}
