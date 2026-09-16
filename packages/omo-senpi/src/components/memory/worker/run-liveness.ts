import {
  getPidLiveness as readPidLiveness,
  getProcessStartIdentity as readProcessStartIdentity,
  startIdentitiesComparable,
  type ProcessLiveness,
} from "@oh-my-opencode/memory-core"

export type RunProcessVerdict = "alive" | "dead" | "unknown" | "absent"

export interface RunLivenessSeams {
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
}

/**
 * A live pid is dead only when its recorded start identity provably belongs to another process.
 * Two identities prove reuse only inside one scheme: a ledger written as `ps-lstart:` by a
 * supervisor and read back as `proc-start-epoch:` by this runtime describes the same instant
 * in different words, and treating that as reuse tore live worktrees down mid-run (#8304).
 */
function recordedStartWasReused(recorded: string, actual: string): boolean {
  return startIdentitiesComparable(recorded, actual) && recorded !== actual
}

export async function classifyRunProcess(
  pid: number | undefined,
  recordedStart: string | null | undefined,
  seams: RunLivenessSeams,
): Promise<RunProcessVerdict> {
  if (pid === undefined) return "absent"
  if (recordedStart === undefined) return "unknown"
  const liveness = (seams.getPidLiveness ?? readPidLiveness)(pid)
  if (liveness === "dead") return "dead"
  if (liveness === "unknown") return "unknown"
  const actualStart = await (seams.getProcessStartIdentity ?? readProcessStartIdentity)(pid)
  if (recordedStart === null || actualStart === null) return "unknown"
  return recordedStartWasReused(recordedStart, actualStart) ? "dead" : "alive"
}

/** Launcher liveness: dead on ESRCH, or on a live pid whose recorded start identity proves reuse. */
export async function isLauncherDead(
  pid: number,
  recordedStart: string | null | undefined,
  seams: RunLivenessSeams,
): Promise<boolean> {
  const liveness = (seams.getPidLiveness ?? readPidLiveness)(pid)
  if (liveness === "dead") return true
  if (liveness === "alive" && recordedStart !== null && recordedStart !== undefined) {
    const actualStart = await (seams.getProcessStartIdentity ?? readProcessStartIdentity)(pid)
    return actualStart !== null && recordedStartWasReused(recordedStart, actualStart)
  }
  return false
}

export function signalRecordedProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

export async function waitUntil(deadlineAt: number, now: () => number): Promise<void> {
  const delay = Math.max(0, deadlineAt - now())
  if (delay === 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, delay))
}
