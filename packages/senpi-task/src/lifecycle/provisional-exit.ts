import type { TaskRecord } from "../state"
import type { LifecycleContext } from "./context"
import { claimResidencySlot } from "./residency"
import { markLost } from "./revive-rollback"
import type { ReconcileOutcome } from "./types"

/** An unconfirmed exit is interrupted work, never a transcript to replay after losing its owner. */
export async function reconcileProvisionalExit(context: LifecycleContext, observed: TaskRecord): Promise<ReconcileOutcome> {
  try {
    const claim = claimResidencySlot(context, observed.task_id, (fresh) =>
      (fresh.status === "running" || fresh.status === "pending")
      && fresh.host_pid === observed.host_pid
      && fresh.updated_at === observed.updated_at
      && fresh.residency_state === observed.residency_state
      && fresh.residency_claim === observed.residency_claim
      && fresh.provisional_exit?.run_epoch === fresh.notification.run_epoch
      && fresh.provisional_exit?.observed_at === observed.provisional_exit?.observed_at
      && context.registry.get(fresh.task_id) === undefined
      && (fresh.host_pid === undefined || fresh.host_pid === context.hostPid || !context.signaller.isAlive(fresh.host_pid)),
    )
    if (claim !== "claimed") return { task_id: observed.task_id, kind: "foreign_live_owner", reason: "provisional exit claim changed" }
  } catch {
    return { task_id: observed.task_id, kind: "foreign_live_owner", reason: "provisional exit lock contended" }
  }
  const claimed = context.store.load(observed.task_id)
  if (claimed === null) return { task_id: observed.task_id, kind: "resumed", reason: "record removed" }
  return settleProvisionalExitLoss(context, claimed)
}

/** Shared by startup and deferred revival after either path has claimed the record. */
export async function settleProvisionalExitLoss(context: LifecycleContext, claimed: TaskRecord): Promise<ReconcileOutcome> {
  // Accepted conservative edge: an independent crash followed by parent death during confirmation
  // is LOST too. Only a manager that committed ERROR while still alive may establish failure.
  await markLost(context, claimed, "owner exited before confirming the child's unexpected exit")
  return context.store.load(claimed.task_id)?.status === "lost"
    ? { task_id: claimed.task_id, kind: "lost", reason: "unconfirmed child exit after owner loss" }
    : { task_id: claimed.task_id, kind: "foreign_live_owner", reason: "provisional exit claim changed" }
}
