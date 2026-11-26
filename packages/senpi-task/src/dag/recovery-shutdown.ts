// The shutdown pause: every live run of the session this host holds (or whose holder is gone) is
// paused, and the pause write hands this host's lease over as the previous holder (#15125).
import { dagRunPausedEvent } from "./events"
import { listRunRecords, recoveryJournal, type RecoverableRecord, type RecoveryContext } from "./recovery"
import { acquireDagRun } from "./run-acquisition"
import type { DagRunId } from "./types"

const LIVE_RUN_STATUSES = new Set(["pending", "running"])

export function pauseRunsForShutdown(context: RecoveryContext, parentSessionId: string): readonly DagRunId[] {
  const paused: DagRunId[] = []
  for (const observed of listRunRecords(context.store)) {
    // Decided on the fresh record under the run lock like every other entry: a live run of this
    // session that no other live process holds. The acquisition records this host's lease, which the
    // pause write then hands over as the previous holder.
    const acquired = acquireDagRun<RecoverableRecord>(context.store, observed.runId, {
      operation: "shutdown pause",
      probe: context,
      reservations: context.reservations,
      eligible: (fresh) =>
        fresh.parentSessionId === parentSessionId &&
        LIVE_RUN_STATUSES.has(fresh.status) &&
        fresh.pause?.reason !== "user_stop",
    })
    if (acquired.kind !== "acquired") continue
    try {
      context.stopAdmission?.(observed.runId)
      recoveryJournal(context, acquired.record).append(dagRunPausedEvent({ reason: "session_shutdown" }))
    } finally {
      acquired.reservation?.release()
    }
    paused.push(observed.runId)
  }
  return paused
}
