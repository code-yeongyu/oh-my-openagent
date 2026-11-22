import { windowsTreeKillArgs } from "../../memory-core/src/concurrency/windows-process-tree.mjs"

/**
 * taskkill arguments that end `pid` and its creation-time-checked descendants by explicit /PID (#11006). Windows never
 * rewrites ParentProcessId, so a bare `/T` also ends an older unrelated process naming a recycled parent PID. Empty
 * means nothing may be signalled (the PID is gone, protected, or an ancestor of this process). Without /F, taskkill
 * asks each process to close instead of forcing it.
 */
export function windowsTaskkillArgs(pid: number, force: boolean): string[] {
  const args = windowsTreeKillArgs(pid)
  return force ? args : args.filter((arg) => arg !== "/F")
}
