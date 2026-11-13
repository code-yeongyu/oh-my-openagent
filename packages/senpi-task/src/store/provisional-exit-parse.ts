import type { TaskRecord } from "../state"
import { isRecord, readNumber, readString } from "./scalar-read"

export function parseOptionalProvisionalExit(record: Record<string, unknown>): TaskRecord["provisional_exit"] {
  const value = record["provisional_exit"]
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("provisional_exit is not an object")
  return {
    observed_at: readString(value, "observed_at"),
    run_epoch: readNumber(value, "run_epoch"),
    code: value["code"] === null ? null : readNumber(value, "code"),
    signal: value["signal"] === null ? null : readString(value, "signal"),
  }
}
