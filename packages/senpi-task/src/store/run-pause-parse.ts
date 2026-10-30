import type { RecordedRunPause } from "../state/record-types"

type RunKind = RecordedRunPause["run_ref"]["kind"]

function isRunKind(value: unknown): value is RunKind {
  return value === "dag" || value === "task" || value === "workpool" || value === "team"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseOptionalRunPause(record: Record<string, unknown>): RecordedRunPause | undefined {
  const value = record["run_pause"]
  if (value === undefined) return undefined
  if (!isRecord(value) || typeof value.parent_session_id !== "string" || value.parent_session_id.length === 0
    || typeof value.parent_pause_seq !== "number" || !Number.isSafeInteger(value.parent_pause_seq) || value.parent_pause_seq < 1
    || !isRecord(value.run_ref)) throw new Error("run_pause is malformed")
  const { kind, id } = value.run_ref
  if (!isRunKind(kind) || typeof id !== "string" || id.length === 0) throw new Error("run_pause.run_ref is malformed")
  return { parent_session_id: value.parent_session_id, parent_pause_seq: value.parent_pause_seq, run_ref: { kind, id } }
}
