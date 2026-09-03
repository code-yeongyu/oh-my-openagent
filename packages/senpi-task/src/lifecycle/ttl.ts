import type { TaskRecord } from "../state"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { CleanupResult } from "./types"

/**
 * Delete terminal records + artifacts older than task.ttl_ms. Non-terminal records are always kept
 * (a suspended child whose work is in flight is NEVER TTL-deleted). A `lost` process record is
 * NEVER deleted without pid-dead proof (its breadcrumbs may still be needed). Records with a live
 * resident handle in this process are retained: deleting them would orphan an in-memory handle and
 * allow late transcript appends to recreate the deleted log. The same protection extends across
 * processes: a resident record owned by a LIVE host process (host_pid alive) is that process's
 * revivable handle and must not be expunged from under it. A terminal record whose completion
 * notification is still undelivered (the notify_on_terminal population AND the legacy
 * failed-delivery population) is retained so the completion reconciler can recover it.
 *
 * Every expunge is TWO PHASES around an atomic conditional tombstone (store.tombstoneIfExpired):
 * phase 1 (inside the record lock) re-reads + re-validates + renames the record to
 * <taskId>.json.expunging - the locked re-read is what closes the scan-then-delete claim race, and
 * the tombstone makes the record invisible so no claim can take it afterwards. Phase 2 (outside
 * the lock) deletes the children dir, spill, and log, then drops the tombstone. Every sweep FIRST
 * completes phase 2 for tombstones left behind by a crashed sweep: a tombstoned record is already
 * committed to deletion and is never resurrected, so completion is idempotent and lock-free.
 */
export async function cleanupExpiredRecords(context: LifecycleContext): Promise<CleanupResult> {
  const deleted: string[] = []
  const retained: string[] = []

  // Crash recovery before anything else: finish the interrupted expunges of a previous sweep.
  for (const taskId of context.store.listExpunging()) {
    context.store.completeExpunge(taskId)
    deleted.push(taskId)
  }

  const cutoff = context.now() - context.config.ttl_ms
  for (const record of context.store.list().records) {
    if (shouldRetain(context, record, cutoff)) {
      retained.push(record.task_id)
      continue
    }
    // Phase 1: atomic re-validate + tombstone. A revival claim that landed after the scan is seen
    // by the locked re-read and the record is retained instead of deleted underneath its new owner.
    const outcome = context.store.tombstoneIfExpired(record.task_id, (fresh) => shouldRetain(context, fresh, cutoff))
    if (outcome.kind !== "tombstoned") {
      retained.push(record.task_id)
      continue
    }
    // The record is now committed to deletion. A live orphan rpc pid must not outlive its record:
    // destroy it through the single-writer port BEFORE phase 2 artifact deletion (no-orphan law).
    const orphanPid = outcome.record.execution_mode === "process" ? outcome.record.pid : undefined
    if (orphanPid !== undefined && context.signaller.isAlive(orphanPid)) {
      await destroyResidentTask(context, record.task_id, "ttl", orphanPid)
    }
    // Phase 2: children dir, spill, log, then drop the tombstone.
    context.store.completeExpunge(record.task_id)
    deleted.push(record.task_id)
  }
  return { deleted, retained }
}

function shouldRetain(context: LifecycleContext, record: TaskRecord, cutoff: number): boolean {
  if (context.registry.get(record.task_id) !== undefined) return true
  if (hasLiveHostClaim(context, record)) return true
  if (!TERMINAL_STATUSES.has(record.status)) return true
  const retainedAt = record.terminal_at ?? record.updated_at
  if (Date.parse(retainedAt) > cutoff) return true
  if (hasUndeliveredTerminalNotification(record)) return true
  if (record.status === "lost" && record.execution_mode === "process") {
    // The lost-record pid-dead proof rule: breadcrumbs are kept until the process is proven dead.
    return record.pid === undefined || context.signaller.isAlive(record.pid)
  }
  return false
}

// A resident record whose claiming host process is alive is that host's revivable handle. This
// covers a FOREIGN live owner AND this process's own fresh claim (revival claims under the
// admission lock, respawns outside it - during that window no live handle exists in the registry
// yet, but the claim is no less real). Deleting either would orphan a live owner.
function hasLiveHostClaim(context: LifecycleContext, record: TaskRecord): boolean {
  return (
    record.residency_state === "resident" &&
    record.host_pid !== undefined &&
    context.signaller.isAlive(record.host_pid)
  )
}

// TTL must never delete a terminal record (or its completion spill) whose notification is still
// undelivered. BOTH populations the unnotified-completion reconciler recovers are covered: records
// with notify_on_terminal whose notified epoch lags the run epoch, AND legacy pre-upgrade records
// whose only marker is a notification_failed_epoch with a lagging notified epoch (a record sitting
// between a failed retry and the next one).
function hasUndeliveredTerminalNotification(record: TaskRecord): boolean {
  const notification = record.notification
  if (notification.notified_epoch >= notification.run_epoch) return false
  if (record.notify_on_terminal) return true
  return notification.notification_failed_epoch !== undefined
}
