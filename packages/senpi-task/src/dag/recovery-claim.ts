// The claim: whether a session may take a paused or interrupted run over. It goes through the one
// acquisition (`run-acquisition.ts`): eligibility on the fresh record under the run lock, the holder
// rule, this process's per-run reservation (held until the caller adopts or abandons the run), then
// the lease (#15125).
import type { RecoverableRecord, RecoveryContext } from "./recovery"
import { acquireDagRun, dagRunEligibility, type DagRunAcquisition } from "./run-acquisition"
import type { DagRunId } from "./types"

export type ClaimedRun =
  | { readonly kind: "claimed"; readonly record: RecoverableRecord; readonly release: () => void }
  | { readonly kind: "skipped"; readonly reason: "foreign_session" | "not_paused" | "busy" }
  | { readonly kind: "skipped"; readonly reason: "live_lease"; readonly holderPid: number }

// Only an immediate fork source can be adopted, and its recorded holder must still prove
// abandonment. Missing holders and live foreign processes remain protected.
export function claimOrphanedRun(
  context: RecoveryContext,
  runId: DagRunId,
  sourceSessionId: string,
  parentSessionId: string,
): ClaimedRun {
  const recordedHolder = (fresh: RecoverableRecord) => fresh.leaseHolderPid ?? fresh.previousLeaseHolderPid
  const acquired = acquireDagRun<RecoverableRecord>(context.store, runId, {
    operation: "recovery",
    probe: context,
    reservations: context.reservations,
    eligible: dagRunEligibility.forkSourceAdoption(sourceSessionId),
    holder: (fresh) => {
      const holder = recordedHolder(fresh)
      return holder !== undefined && holder !== context.hostPid && context.isProcessAlive(holder) ? holder : undefined
    },
    // Re-home fully: parent AND root move to the adopter so children spawned after the resume
    // carry live ancestry, matching what a fresh start records (the dag tool wires root = session).
    claim: (fresh) => ({ ...fresh, parentSessionId, rootSessionId: parentSessionId }),
  })
  if (acquired.kind !== "not_eligible") return claimOutcome(context, acquired)
  return { kind: "skipped", reason: acquired.record.status === "paused" ? "foreign_session" : "not_paused" }
}

/** Automatic recovery never takes a run the user stopped; the user's Resume takes exactly its Stop. */
export type ClaimMode = { readonly kind: "automatic" } | { readonly kind: "resume"; readonly pauseSeq: number }

export function claimPausedRun(
  context: RecoveryContext,
  runId: DagRunId,
  parentSessionId: string,
  mode: ClaimMode,
): ClaimedRun {
  // A host that dies without its shutdown pause (kill, crash, power loss) leaves the run `running`.
  // With no scheduler for it in this process it is as stopped as a paused run and is claimed the
  // same way; nothing else would ever fold its children or start its dependents. Our own pid is
  // always alive to a signal-0 probe, so for a run this host recorded the only holder that can still
  // matter is a scheduler registered in this process (same-runtime pause + re-attach).
  const heldHere = (): boolean | undefined => context.isRunHeldInProcess?.(runId)
  const acquired = acquireDagRun<RecoverableRecord>(context.store, runId, {
    operation: mode.kind === "resume" ? "resume" : "recovery",
    probe: context,
    reservations: context.reservations,
    eligible:
      mode.kind === "resume"
        ? dagRunEligibility.userResume(parentSessionId, mode.pauseSeq, heldHere)
        : dagRunEligibility.automaticRecovery(parentSessionId, heldHere),
  })
  if (acquired.kind !== "not_eligible") return claimOutcome(context, acquired)
  const fresh = acquired.record
  if (fresh.parentSessionId !== parentSessionId) return { kind: "skipped", reason: "foreign_session" }
  if (fresh.status === "paused" && heldHere() === true) {
    return { kind: "skipped", reason: "live_lease", holderPid: context.hostPid }
  }
  return { kind: "skipped", reason: "not_paused" }
}

function claimOutcome(
  context: RecoveryContext,
  acquired: Exclude<DagRunAcquisition<RecoverableRecord>, { readonly kind: "not_eligible" }>,
): ClaimedRun {
  switch (acquired.kind) {
    case "acquired":
      return { kind: "claimed", record: acquired.record, release: () => acquired.reservation?.release() }
    case "held":
      return { kind: "skipped", reason: "live_lease", holderPid: acquired.holderPid }
    case "busy":
      // Another operation of this process is installing or mutating the run: ask again once it releases it.
      return { kind: "skipped", reason: "busy" }
    case "missing":
      return { kind: "skipped", reason: "not_paused" }
  }
}
