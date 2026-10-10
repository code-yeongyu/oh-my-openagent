import { log } from "@oh-my-opencode/utils"

import type { ReattachResult } from "../lifecycle/port"
import { nextRunEpoch, type TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { discardManagedHandle, releaseSupersededHandle, type ManagedChildHandle } from "./child-handle"
import { childIdentityOf, hasChildIdentity, isTerminalRecord, nowIso, recordSpawnedRunner } from "./manager-helpers"

/**
 * A handle rejected because someone else owns the task now. A revived daemon child reattaches to the
 * task's one daemon session, which that owner may be using: this process only detaches from it. A
 * process child was spawned for this attempt alone and is ended.
 */
async function letGoOfRejected(handle: ManagedChildHandle): Promise<void> {
  if (handle.kind === "host-session") await releaseSupersededHandle(handle)
  else await discardManagedHandle(handle)
}

/**
 * Bind a freshly respawned handle back onto its record: verify this host still holds the claim,
 * refuse a task that already has a live handle, then either refresh a terminal record's launch
 * facts or open a NEW run epoch for a continuing one. Every failure path tears the handle down, so
 * a rejected reattach never leaves a child nobody owns.
 */
export async function reattachManagedTask(input: {
  readonly record: TaskRecord
  readonly handle: ManagedChildHandle
  readonly store: TaskRecordStore
  readonly hostPid: number
  readonly now: () => number
  readonly isAttached: (taskId: string) => boolean
  readonly attachLive: (record: TaskRecord, handle: ManagedChildHandle) => () => void
  readonly detachLive: (taskId: string, handle: ManagedChildHandle, unsubscribe: () => void) => void
  readonly destroyAttached: (taskId: string) => Promise<void>
  readonly armOutcome: (record: TaskRecord, handle: ManagedChildHandle, epoch: number) => void
}): Promise<ReattachResult> {
  const fresh = input.store.load(input.record.task_id)
  if (fresh?.host_pid !== input.hostPid || fresh.residency_state !== "resident" || fresh.killed === true) {
    await letGoOfRejected(input.handle)
    return { ok: false, kind: "failed", reason: "task ownership claim is not held by this host" }
  }
  // The revival that launched this handle must still hold the claim it launched under: another revival
  // may have claimed the task since (at the same epoch when the task was interrupted or terminal), and
  // an obsolete handle must not attach on that newer claim.
  if (input.record.residency_claim !== undefined && (fresh.residency_claim !== input.record.residency_claim || fresh.notification.run_epoch !== input.record.notification.run_epoch)) {
    await letGoOfRejected(input.handle)
    return { ok: false, kind: "failed", reason: "the revival's residency claim was superseded" }
  }
  if (input.isAttached(fresh.task_id)) {
    await letGoOfRejected(input.handle)
    return { ok: false, kind: "already_attached", reason: "task already has a live handle" }
  }
  // A respawn begun for a live run whose task was stopped meanwhile must not become resident: only a
  // task that was already terminal when its revival began is reattached as terminal.
  if (isTerminalRecord(fresh) && !isTerminalRecord(input.record)) {
    await discardManagedHandle(input.handle)
    return { ok: false, kind: "failed", reason: "task ended while its child was being reattached" }
  }
  let unsubscribe: (() => void) | undefined
  let attached = false
  try {
    unsubscribe = input.attachLive(fresh, input.handle)
    attached = true
    if (isTerminalRecord(fresh)) {
      // The result stays, but the child now lives behind THIS handle: a daemon session reopened on a
      // newer generation answers under a new instance and routing id, so its identity is restamped.
      const identity = childIdentityOf(input.handle)
      const sessionId = input.handle.sessionId
      const childSession = sessionId === undefined || sessionId.length === 0 ? {} : { child_session_id: sessionId }
      if (hasChildIdentity(identity) || childSession.child_session_id !== undefined) {
        input.store.mutate(fresh.task_id, (current) => ({ ...current, ...identity, ...childSession }))
      }
      return { ok: true }
    }
    const {
      error_message: _error,
      failure_kind: _failureKind,
      failure_reason: _failureReason,
      final_response: _final,
      killed: _killed,
      fallback_handoff_epoch: _handoff,
      ...rest
    } = fresh
    const epoch = nextRunEpoch(fresh)
    const timestamp = nowIso(input.now)
    const sessionId = input.handle.sessionId
    // A revived daemon child is identified by its session, exactly as a fresh spawn stamps it.
    const withRunner = recordSpawnedRunner(rest, input.handle.kind, input.handle.hostSession) ?? rest
    const reattached: TaskRecord = {
      ...withRunner,
      status: "running",
      started_at: fresh.started_at ?? timestamp,
      updated_at: timestamp,
      notification: { ...fresh.notification, run_epoch: epoch },
      ...(input.handle.pid === undefined ? {} : { pid: input.handle.pid }),
      ...(sessionId === undefined || sessionId.length === 0 ? {} : { child_session_id: sessionId }),
    }
    input.store.replace(reattached)
    input.armOutcome(reattached, input.handle, epoch)
    return { ok: true }
  } catch (error) {
    if (attached) await input.destroyAttached(fresh.task_id)
    else await discardManagedHandle(input.handle)
    if (unsubscribe !== undefined) input.detachLive(fresh.task_id, input.handle, unsubscribe)
    log("senpi-task reattach failed", { taskId: fresh.task_id, error: String(error) })
    return { ok: false, kind: "failed", reason: "manager reattach failed" }
  }
}
