import { log } from "@oh-my-opencode/utils"

import { markRecordLostForReconciliation, transitionTaskRecord, type TaskRecord, type TaskTransitionAudit } from "../state"
import { delay, nowIso, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { ReconcileDeferredReason, ReconcileOutcome } from "./types"

/**
 * What a revival does when it CANNOT proceed. Three answers, and only three: terminate the previous
 * child-process child so the replacement never races it, hand the claim back so the record stays
 * revivable (deferred), or - when the record can never be revived again - mark it lost. The
 * daemon-hosted path only ever reaches the first two: a session has no pid, and a parked session
 * always has a transcript to reopen.
 */

export type SuspendedResidency = "persisted_only" | "rpc_detached"

export function deferred(taskId: string, reason: ReconcileDeferredReason): ReconcileOutcome {
  return { task_id: taskId, kind: "deferred", reason }
}

export async function terminateOldRpc(context: LifecycleContext, record: TaskRecord): Promise<boolean> {
  const pid = record.pid
  if (pid === undefined || !context.signaller.isAlive(pid)) return true
  context.signaller.signal(pid, "SIGTERM")
  context.store.appendEvent(record.task_id, { type: "reconcile_terminated", payload: { pid, signal: "SIGTERM" } })
  await delay(context.orphanKillDelayMs)
  if (context.signaller.isAlive(pid)) {
    context.signaller.signal(pid, "SIGKILL")
    context.store.appendEvent(record.task_id, { type: "reconcile_terminated", payload: { pid, signal: "SIGKILL" } })
  }
  return !context.signaller.isAlive(pid)
}

export function rollbackOrDeferred(
  context: LifecycleContext,
  taskId: string,
  residency: SuspendedResidency,
  successReason: ReconcileDeferredReason,
  claim?: TaskRecord,
): ReconcileOutcome {
  return rollbackClaim(context, taskId, residency, claim)
    ? deferred(taskId, successReason)
    : deferred(taskId, "rollback_failed")
}

/**
 * Whether `fresh` is still held by the very claim `claim` took. Another revival in this process (same
 * host pid) that claimed and attached the task since - at a later epoch, or at the same one when it
 * revived an interrupted or terminal task - holds a different claim and is never undone by this one.
 */
export function holdsClaim(context: LifecycleContext, fresh: TaskRecord, claim: TaskRecord | undefined): boolean {
  if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident") return false
  if (claim === undefined) return true
  return fresh.notification.run_epoch === claim.notification.run_epoch && fresh.residency_claim === claim.residency_claim
}

function rollbackClaim(context: LifecycleContext, taskId: string, residency: SuspendedResidency, claim: TaskRecord | undefined): boolean {
  try {
    context.store.mutate(taskId, (fresh) => {
      if (!holdsClaim(context, fresh, claim)) return fresh
      const { host_pid: _hostPid, residency_claim: _released, ...withoutHost } = fresh
      if (residency === "rpc_detached") {
        return { ...withoutHost, residency_state: residency, updated_at: nowIso(context) }
      }
      const { pid: _pid, ...withoutPid } = withoutHost
      return { ...withoutPid, residency_state: residency, updated_at: nowIso(context) }
    })
    return true
  } catch (error) {
    log("senpi-task reconcile ownership rollback failed", {
      taskId,
      residency,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function markLost(context: LifecycleContext, record: TaskRecord, message: string): Promise<void> {
  let applied = false
  context.store.mutate(record.task_id, (fresh) => {
    if (!holdsClaim(context, fresh, record.residency_claim === undefined ? undefined : record)) return fresh
    const result = markRecordLostForReconciliation(fresh, {
      timestamp: nowIso(context),
      error_message: message,
      updateReason: fresh.status === "lost",
    })
    if (!result.applied) return fresh
    applied = true
    return result.record
  })
  if (!applied) return
  context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
}

/** Dispose a terminal record this revival claimed, unless another revival has claimed it since. */
export function disposeClaimed(context: LifecycleContext, claim: TaskRecord): void {
  let audit: TaskTransitionAudit | undefined
  context.store.mutate(claim.task_id, (fresh) => {
    if (!holdsClaim(context, fresh, claim)) return fresh
    const result = transitionTaskRecord(fresh, { type: "dispose", timestamp: nowIso(context) })
    audit = result.audit
    return result.applied ? result.record : fresh
  })
  if (audit !== undefined) context.store.appendEvent(claim.task_id, { type: audit.type, payload: audit })
}
