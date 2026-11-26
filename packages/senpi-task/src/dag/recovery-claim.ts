// The claim: whether a session may take a paused or interrupted run over, decided under the run lock
// from who holds it (`run-lease.ts`) and whether this process still schedules it.
import type { RecoverableRecord, RecoveryContext } from "./recovery"
import { liveChildOwner } from "./run-lease"
import type { DagRunId } from "./types"

export type ClaimedRun =
  | { readonly kind: "claimed"; readonly record: RecoverableRecord }
  | { readonly kind: "skipped"; readonly reason: "foreign_session" | "not_paused" }
  | { readonly kind: "skipped"; readonly reason: "live_lease"; readonly holderPid: number }

// Only an immediate fork source can be adopted, and its recorded holder must still prove
// abandonment. Missing holders and live foreign processes remain protected.
export function claimOrphanedRun(
  context: RecoveryContext,
  observed: RecoverableRecord,
  parentSessionId: string,
): ClaimedRun {
  const runId = observed.runId
  return context.store.withRunLock(runId, () => {
    if (context.installing.has(runId)) return { kind: "skipped", reason: "live_lease", holderPid: context.hostPid }
    const fresh = context.store.readCheckpoint<RecoverableRecord>(runId)
    if (fresh === null || fresh.status !== "paused") return { kind: "skipped", reason: "not_paused" }
    if (fresh.parentSessionId !== observed.parentSessionId) return { kind: "skipped", reason: "foreign_session" }
    const holder = fresh.leaseHolderPid ?? fresh.previousLeaseHolderPid
    if (holder === undefined) return { kind: "skipped", reason: "foreign_session" }
    if (holder !== context.hostPid && context.isProcessAlive(holder)) {
      return { kind: "skipped", reason: "live_lease", holderPid: holder }
    }
    // Re-home fully: parent AND root move to the adopter so children spawned after the resume
    // carry live ancestry, matching what a fresh start records (the dag tool wires root = session).
    const claimed: RecoverableRecord = {
      ...fresh,
      parentSessionId,
      rootSessionId: parentSessionId,
      leaseHolderPid: context.hostPid,
    }
    context.store.writeCheckpoint(runId, claimed)
    context.installing.add(runId)
    return { kind: "claimed", record: claimed }
  })
}

export function claimPausedRun(context: RecoveryContext, runId: DagRunId, parentSessionId: string): ClaimedRun {
  return context.store.withRunLock(runId, () => {
    if (context.installing.has(runId)) return { kind: "skipped", reason: "live_lease", holderPid: context.hostPid }
    const fresh = context.store.readCheckpoint<RecoverableRecord>(runId)
    if (fresh === null) return { kind: "skipped", reason: "not_paused" }
    // A host that dies without its shutdown pause (kill, crash, power loss) leaves the run `running`.
    // With no scheduler for it in this process it is as stopped as a paused run and is claimed the
    // same way; nothing else would ever fold its children or start its dependents.
    const interrupted = fresh.status === "running" && context.isRunHeldInProcess?.(runId) === false
    if (fresh.status !== "paused" && !interrupted) return { kind: "skipped", reason: "not_paused" }
    if (fresh.parentSessionId !== parentSessionId) return { kind: "skipped", reason: "foreign_session" }
    const priorHolder =
      fresh.leaseHolderPid ?? fresh.previousLeaseHolderPid ?? (interrupted ? liveChildOwner(context, fresh) : undefined)
    if (priorHolder !== undefined && holderStillLive(context, runId, priorHolder)) {
      return { kind: "skipped", reason: "live_lease", holderPid: priorHolder }
    }
    const claimed: RecoverableRecord = { ...fresh, leaseHolderPid: context.hostPid }
    context.store.writeCheckpoint(runId, claimed)
    context.installing.add(runId)
    return { kind: "claimed", record: claimed }
  })
}

// Our own pid is always alive to a signal-0 probe, so for it the only holder that can still matter
// is a scheduler registered in this process (same-runtime pause + re-attach). A fresh runtime that
// reopens the session in the same process holds nothing and claims. Every other pid keeps the
// cross-host liveness fence: two live host processes must never both schedule a run.
function holderStillLive(context: RecoveryContext, runId: DagRunId, holderPid: number): boolean {
  if (holderPid === context.hostPid) return context.isRunHeldInProcess?.(runId) ?? false
  return context.isProcessAlive(holderPid)
}
