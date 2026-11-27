// The paused run's status word in the DAG widget header: who, if anyone, is taking it over.
import type { DagStatusRunSnapshot } from "./dag-status-row-format"

// Priority is deliberate. A live lease means another process already claimed this run and is
// reconciling it, so "paused" would be stale by the time it is painted. Without that lease, nodes
// still recorded as running are stranded work the header must own rather than hide behind "paused".
export function pausedStatusText(run: DagStatusRunSnapshot, isAlive: (pid: number) => boolean): string {
  if (run.leaseHolderPid !== undefined && isAlive(run.leaseHolderPid)) return "resuming"
  const running = run.nodes.reduce((count, node) => count + (node.state === "running" ? 1 : 0), 0)
  return running > 0 ? `suspended · ${running} active` : "paused"
}

// Signal 0 probes existence without delivering anything. ESRCH is the only "gone" answer: EPERM
// means the pid exists under another uid, which still counts as a live lease holder.
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH"
  }
}
