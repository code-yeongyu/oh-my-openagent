import { randomUUID } from "node:crypto"

import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import type { ExpungeOwner } from "../store"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { attemptInFlight, holdAttempt } from "./expunge-attempts"
import { endClosingFallbackChild } from "./fallback-closing-child"
import { isHostSessionRecord } from "./host-session"
import { closeHostSession } from "./host-session-close"
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
 * the tombstone makes the record invisible so no claim can take it afterwards. The record's child (its
 * daemon session or process) is ended only while the tombstone holds that exclusive claim, and a
 * close the daemon does not confirm puts the record back (restoreExpunging) for the next sweep
 * instead of deleting its only pointer to a session that may still be open. A close still in flight
 * when the sweep gives up keeps the tombstone (the late close could otherwise hit a revived run), and
 * that close restores or deletes the record once it settles. Phase 2 (outside the lock) deletes the
 * children dir, spill, and log, then drops the tombstone. Each tombstone names the sweep attempt that
 * owns it (`ExpungeOwner`): only that attempt restores or deletes it, so a concurrent sweep never
 * treats a live attempt's tombstone as a crashed one. Every sweep FIRST takes over the tombstones of
 * attempts whose process is gone and finishes them under the same close-or-restore rule.
 */
export async function cleanupExpiredRecords(context: LifecycleContext): Promise<CleanupResult> {
  const deleted: string[] = []
  const retained: string[] = []

  // ONE daemon snapshot for the whole sweep: every host-session record below is matched against it
  // by session path, never probed on its own.
  context.hostSessionProbe.refresh()

  const owner: ExpungeOwner = { pid: context.hostPid, token: randomUUID() }
  const endSweep = holdAttempt(owner.token)
  try {
    return await sweepExpired(context, owner, deleted, retained)
  } finally {
    endSweep()
  }
}

async function sweepExpired(context: LifecycleContext, owner: ExpungeOwner, deleted: string[], retained: string[]): Promise<CleanupResult> {

  // Crash recovery before anything else: finish the expunges of attempts whose process is gone. A
  // tombstone owned by a live attempt (another sweep, possibly still waiting on its close) is its own.
  // One close attempt per record per sweep: a record recovery just restored waits for the next sweep.
  const handled = new Set<string>()
  for (const taskId of context.store.listExpunging()) {
    const previous = context.store.readExpungeOwner(taskId)
    if (previous !== undefined && isLiveAttempt(context, previous)) continue
    if (!context.store.takeOverExpunging(taskId, previous, owner)) continue
    handled.add(taskId)
    // Only a daemon session is safely identifiable after a crash: a process pid in an arbitrarily old
    // tombstone may have been reused, and the sweep that wrote it already ended its process.
    const pending = loadTombstone(context, taskId)
    const ended = pending !== null && isHostSessionRecord(pending) ? await endOwnedChild(context, taskId, pending, owner) : true
    await finishExpunge(context, taskId, ended, owner, { deleted, retained })
  }

  const cutoff = context.now() - context.config.ttl_ms
  for (const record of context.store.list().records) {
    if (handled.has(record.task_id)) continue
    if (shouldRetain(context, record, cutoff)) {
      retained.push(record.task_id)
      continue
    }
    // A runtime-fallback child still waiting for its close is the record's last pointer to it: the
    // record stays until the child is confirmed gone, and the next sweep retries.
    if (!(await endClosingFallbackChild(context, record))) {
      retained.push(record.task_id)
      continue
    }
    // Phase 1: atomic re-validate + tombstone. A revival claim that landed after the scan is seen
    // by the locked re-read and the record is retained instead of deleted underneath its new owner.
    const outcome = context.store.tombstoneIfExpired(record.task_id, (fresh) => shouldRetain(context, fresh, cutoff), owner)
    if (outcome.kind !== "tombstoned") {
      retained.push(record.task_id)
      continue
    }
    // The record is now invisible to every claim. A live orphan must not outlive its record (no-orphan
    // law): its child is ended BEFORE phase 2, and a close that is not confirmed restores the record.
    await finishExpunge(context, record.task_id, await endOwnedChild(context, record.task_id, outcome.record, owner), owner, { deleted, retained })
  }
  return { deleted, retained }
}

type SweepResult = { readonly deleted: string[]; readonly retained: string[] }
// Wrapped so an async function returning it cannot adopt (and so await) the in-flight close.
type ChildEnd = boolean | { readonly pending: Promise<boolean> }

async function finishExpunge(
  context: LifecycleContext,
  taskId: string,
  ended: ChildEnd,
  owner: ExpungeOwner,
  result: SweepResult,
): Promise<void> {
  if (ended === true) {
    // Phase 2: children dir, spill, log, then drop the tombstone. An expunged record can never be
    // revived, so its runtime parent kernel-tool binding goes with it.
    if (context.store.completeExpunge(taskId, owner)) {
      context.kernelToolBindings?.release(taskId)
      result.deleted.push(taskId)
    } else {
      result.retained.push(taskId)
    }
    return
  }
  if (ended === false) {
    context.store.restoreExpunging(taskId, owner)
    result.retained.push(taskId)
    return
  }
  // The close is still in flight: the tombstone stays (this attempt still owns it, so no other sweep
  // restores it), and the settled answer decides between deletion and restore. A failure there drops the
  // attempt, so the next sweep takes the tombstone over instead of it staying stranded.
  result.retained.push(taskId)
  const release = holdAttempt(owner.token)
  void settleDeferred(context, taskId, ended.pending, owner).finally(release)
}

async function settleDeferred(context: LifecycleContext, taskId: string, pending: Promise<boolean>, owner: ExpungeOwner): Promise<void> {
  try {
    if (!(await pending)) {
      context.store.restoreExpunging(taskId, owner)
      return
    }
    if (context.store.completeExpunge(taskId, owner)) context.kernelToolBindings?.release(taskId)
  } catch (error) {
    log("senpi-task TTL expunge could not settle after a late close; the next sweep retries", { taskId, error: String(error) })
  }
}

// A throw while ending the child must not strand a tombstone this still-running process owns: no later
// sweep in this process would take it over. The record goes back and the error propagates.
async function endOwnedChild(context: LifecycleContext, taskId: string, record: TaskRecord, owner: ExpungeOwner): Promise<ChildEnd> {
  try {
    return await endExpiredChild(context, record)
  } catch (error) {
    context.store.restoreExpunging(taskId, owner)
    throw error
  }
}

// An unreadable tombstone names no child anyone could still end, so phase 2 still runs for it.
function loadTombstone(context: LifecycleContext, taskId: string): TaskRecord | null {
  try {
    return context.store.loadExpunging(taskId)
  } catch (error) {
    log("senpi-task ignored an unreadable TTL tombstone during expunge recovery", {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// An attempt of this process is live while it has work in flight here; one of another process is live
// while that process is.
function isLiveAttempt(context: LifecycleContext, owner: ExpungeOwner): boolean {
  return owner.pid === context.hostPid ? attemptInFlight(owner.token) : context.signaller.isAlive(owner.pid)
}

// A daemon session that is still live is closed and must be confirmed; one the daemon already parked or
// dropped needs nothing. A live process is ended through the single-writer port. A close that has not
// answered yet comes back as the promise of its answer.
async function endExpiredChild(context: LifecycleContext, record: TaskRecord): Promise<ChildEnd> {
  if (isHostSessionRecord(record)) {
    if (!(await context.hostSessionProbe.sessionLive(record.host_session))) return true
    const closed = await closeHostSession(context, record.task_id, record.host_session, record.spawn_spec?.cwd)
    return closed.kind === "pending" ? { pending: closed.settled } : closed.kind === "closed"
  }
  const orphanPid = record.execution_mode === "process" ? record.pid : undefined
  if (orphanPid !== undefined && context.signaller.isAlive(orphanPid)) {
    await destroyResidentTask(context, record.task_id, "ttl", { pid: orphanPid })
  }
  return true
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
