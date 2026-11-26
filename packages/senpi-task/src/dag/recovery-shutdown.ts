// The shutdown pause: every live run of the session this host holds (or whose holder is gone) is
// paused, and the pause write hands this host's lease over as the previous holder (#15125).
import { dagRunPausedEvent } from "./events"
import { listRunRecords, recoveryJournal, type RecoverableRecord, type RecoveryContext } from "./recovery"
import { liveForeignHolder } from "./run-lease"
import type { DagRunId } from "./types"

const LIVE_RUN_STATUSES = new Set(["pending", "running"])

export function pauseRunsForShutdown(context: RecoveryContext, parentSessionId: string): readonly DagRunId[] {
  const paused: DagRunId[] = []
  for (const observed of listRunRecords(context.store)) {
    if (observed.pause?.reason === "user_stop") continue
    if (observed.parentSessionId !== parentSessionId || !LIVE_RUN_STATUSES.has(observed.status)) continue
    // A run a live process elsewhere holds is not this host's to pause (#15125).
    if (liveForeignHolder(context, observed) !== undefined) continue
    context.stopAdmission?.(observed.runId)
    const journal = recoveryJournal(context, observed)
    // The pause write hands a recorded lease over; a holderless legacy record names this host instead.
    journal.append(dagRunPausedEvent({ reason: "session_shutdown" }))
    if (observed.leaseHolderPid === undefined) {
      context.store.withRunLock(observed.runId, () => {
        const fresh = context.store.readCheckpoint<RecoverableRecord>(observed.runId)
        if (fresh?.status === "paused")
          context.store.writeCheckpoint(observed.runId, { ...fresh, previousLeaseHolderPid: context.hostPid })
      })
    }
    paused.push(observed.runId)
  }
  return paused
}
