import {
  getPidLiveness as readPidLiveness,
  getProcessStartIdentity as readProcessStartIdentity,
  type ProcessLiveness,
} from "@oh-my-opencode/memory-core"

export type RunProcessVerdict = "alive" | "dead" | "unknown" | "absent"

export interface RunLivenessSeams {
  readonly getPidLiveness?: (pid: number) => ProcessLiveness
  readonly getProcessStartIdentity?: (pid: number) => Promise<string | null>
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
  return actualStart === recordedStart ? "alive" : "dead"
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
