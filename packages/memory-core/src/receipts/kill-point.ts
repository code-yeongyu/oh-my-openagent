// Crash injection for recovery tests: `OMO_MEMORY_KILL_POINT=<point>` makes the process that reaches that
// point kill itself without cleanup. The variable is read at call time, so the only isolation is the
// process boundary: set it in a child's own environment, never in a process that runs maintenance code.

export const MEMORY_KILL_POINTS = [
  "after-reserve",
  "after-prelaunch",
  "after-worktree",
  "after-child-exit",
  "after-validate",
  "after-merge",
  "before-receipt",
] as const

export type MemoryKillPoint = (typeof MEMORY_KILL_POINTS)[number]

export interface KillPointOptions {
  readonly kill?: (pid: number, signal?: NodeJS.Signals) => void
  readonly platform?: NodeJS.Platform
}

/**
 * Kills this process when `OMO_MEMORY_KILL_POINT` names `point`. Returns how it killed (a POSIX
 * `SIGKILL`, or Windows `TerminateProcess` through `process.kill(pid)`), or undefined when it did not.
 */
export function maybeKillAt(point: MemoryKillPoint, options: KillPointOptions = {}): "signal" | "terminate" | undefined {
  if (process.env.OMO_MEMORY_KILL_POINT !== point) return undefined
  const kill = options.kill ?? ((pid: number, signal?: NodeJS.Signals) => { process.kill(pid, signal) })
  if ((options.platform ?? process.platform) === "win32") {
    kill(process.pid)
    return "terminate"
  }
  kill(process.pid, "SIGKILL")
  return "signal"
}
