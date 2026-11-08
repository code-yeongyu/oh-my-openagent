import { getPidLiveness, getProcessStartIdentity, startIdentitiesComparable, type ProcessLiveness } from "../locks/process-identity"

export type RecordedProcessVerdict = "alive" | "dead" | "unknown" | "absent"

export interface RecordedProcessSeams {
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
}

export type RecordedProcessClassifier = (
  pid: number | undefined,
  recordedStart: string | null | undefined,
  seams?: RecordedProcessSeams,
) => Promise<RecordedProcessVerdict>

async function startVerdict(pid: number, recordedStart: string | null, seams: RecordedProcessSeams): Promise<RecordedProcessVerdict> {
  const actualStart = await (seams.getProcessStartIdentity ?? getProcessStartIdentity)(pid).catch(() => null)
  if (recordedStart === null || actualStart === null) return "unknown"
  return startIdentitiesComparable(recordedStart, actualStart) && recordedStart !== actualStart ? "dead" : "alive"
}

/**
 * A process a VALID run ledger recorded, decided the way reconciliation always has: a ledger without
 * a recorded start is `unknown` before liveness is read, because the queued, launching and deadline
 * paths that consume this verdict treat `unknown` as "keep waiting" (#8304 for the scheme rule).
 */
export async function classifyRecordedProcess(
  pid: number | undefined,
  recordedStart: string | null | undefined,
  seams: RecordedProcessSeams = {},
): Promise<RecordedProcessVerdict> {
  if (pid === undefined) return "absent"
  if (recordedStart === undefined) return "unknown"
  const liveness = (seams.getPidLiveness ?? getPidLiveness)(pid)
  if (liveness === "dead") return "dead"
  if (liveness === "unknown") return "unknown"
  return startVerdict(pid, recordedStart, seams)
}

/**
 * Liveness first, for an UNPARSEABLE or stranded ledger only (#11920): such a ledger has no queued or
 * launching semantics to protect, and a pid the kernel no longer knows is gone whatever start was
 * recorded. The start identity only decides whether a live pid was reused.
 */
export async function classifyRecordedProcessLenient(
  pid: number | undefined,
  recordedStart: string | null | undefined,
  seams: RecordedProcessSeams = {},
): Promise<RecordedProcessVerdict> {
  if (pid === undefined) return "absent"
  const liveness = (seams.getPidLiveness ?? getPidLiveness)(pid)
  if (liveness === "dead") return "dead"
  if (liveness === "unknown" || recordedStart === undefined) return "unknown"
  return startVerdict(pid, recordedStart, seams)
}
