import { getPidLiveness, getProcessStartIdentity, startIdentitiesComparable, type ProcessLiveness } from "../locks/process-identity"

export type RecordedProcessVerdict = "alive" | "dead" | "unknown" | "absent"

export interface RecordedProcessSeams {
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
}

/**
 * A process a run recorded (#11920, the precedence `isLauncherDead` uses): liveness first, so a pid
 * the kernel no longer knows is dead whatever start was recorded; the start identity only decides
 * whether a LIVE pid was reused, and two identities prove reuse only inside one scheme (#8304).
 */
export async function classifyRecordedProcess(
  pid: number | undefined,
  recordedStart: string | null | undefined,
  seams: RecordedProcessSeams = {},
): Promise<RecordedProcessVerdict> {
  if (pid === undefined) return "absent"
  const liveness = (seams.getPidLiveness ?? getPidLiveness)(pid)
  if (liveness === "dead") return "dead"
  if (liveness === "unknown") return "unknown"
  if (recordedStart === null || recordedStart === undefined) return "unknown"
  const actualStart = await (seams.getProcessStartIdentity ?? getProcessStartIdentity)(pid).catch(() => null)
  if (actualStart === null) return "unknown"
  return startIdentitiesComparable(recordedStart, actualStart) && recordedStart !== actualStart ? "dead" : "alive"
}
