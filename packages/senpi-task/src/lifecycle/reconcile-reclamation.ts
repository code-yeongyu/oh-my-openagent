import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { isSpawnSpecV1, markRecordLostForReconciliation } from "../state"
import { delay, nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { getLifecycleReattachPorts, type RespawnFailureCode } from "./port"
import { markCrashedResident } from "./reconcile-crashed-resident"
import { reclaimOrphanedResident } from "./residency"
import type { ReconcileDeferredReason, ReconcileOutcome } from "./types"

export const REVIVABLE_STATUSES = new Set(["pending", "running", "completed", "error", "interrupted"])
const activeLocalReclamations = new Set<string>()

export type SuspendedResidency = "persisted_only" | "rpc_detached"

export type SessionPathResolver = (taskId: string) => string | undefined

export async function reclaimResident(
  context: LifecycleContext,
  observed: TaskRecord,
  sessionPathFor: SessionPathResolver,
): Promise<ReconcileOutcome> {
  const release = beginLocalReclamation(context, observed.task_id)
  if (release === undefined) return deferred(observed.task_id, "foreign_live_owner")
  try {
    return await reclaimResidentExclusive(context, observed, sessionPathFor)
  } finally {
    release()
  }
}

async function reclaimResidentExclusive(
  context: LifecycleContext,
  observed: TaskRecord,
  sessionPathFor: SessionPathResolver,
): Promise<ReconcileOutcome> {
  try {
    if (reclaimOrphanedResident(context, observed) !== "claimed") {
      return deferred(observed.task_id, "foreign_live_owner")
    }
  } catch {
    return deferred(observed.task_id, "lock_contended")
  }

  const claimed = context.store.load(observed.task_id)
  if (claimed === null || claimed.host_pid !== context.hostPid || claimed.residency_state !== "resident") {
    return deferred(observed.task_id, "foreign_live_owner")
  }

  if (claimed.killed === true || claimed.status === "cancelled" || claimed.status === "lost") {
    await destroyResidentTask(context, claimed.task_id, "reconcile_lost")
    return {
      task_id: claimed.task_id,
      kind: claimed.status === "lost" ? "lost" : "resumed",
      reason: claimed.killed === true ? "killed orphan disposed" : `${claimed.status} orphan disposed`,
    }
  }
  if (!REVIVABLE_STATUSES.has(claimed.status)) {
    await destroyResidentTask(context, claimed.task_id, "reconcile_lost")
    return { task_id: claimed.task_id, kind: "resumed", reason: "non-revivable orphan disposed" }
  }

  const sessionPath = sessionPathFor(claimed.task_id)
  if (TERMINAL_STATUSES.has(claimed.status) && sessionPath === undefined) {
    context.store.transition(claimed.task_id, { type: "dispose", timestamp: nowIso(context) })
    return {
      task_id: claimed.task_id,
      kind: "resumed",
      reason: "terminal without transcript disposed; persisted result preserved",
    }
  }

  const rollbackResidency: SuspendedResidency = claimed.execution_mode === "process" ? "rpc_detached" : "persisted_only"
  if (context.config.reattach_on_reconcile === false) {
    const marked = await markCrashedResident(context, claimed, "reattach disabled for crashed resident")
    if (marked) await destroyResidentTask(context, claimed.task_id, "reconcile_lost")
    return { task_id: claimed.task_id, kind: "lost", reason: "reattach disabled for crashed resident" }
  }
  return reviveClaimed(context, claimed, rollbackResidency, sessionPath)
}

export async function reviveClaimed(
  context: LifecycleContext,
  claimed: TaskRecord,
  rollbackResidency: SuspendedResidency,
  sessionPath: string | undefined,
): Promise<ReconcileOutcome> {
  const fresh = context.store.load(claimed.task_id)
  if (!isClaimHeld(context, fresh, claimed.parent_session_id) || fresh.killed === true || !REVIVABLE_STATUSES.has(fresh.status)) {
    return rollbackOrDeferred(context, claimed.task_id, rollbackResidency, "foreign_live_owner")
  }

  if (fresh.execution_mode === "process" && fresh.pid !== undefined) {
    const terminated = await terminateOldRpc(context, fresh)
    if (!terminated) {
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
    }
  }

  if (sessionPath === undefined && !isSpawnSpecV1Record(fresh)) {
    if (TERMINAL_STATUSES.has(fresh.status)) {
      context.store.transition(fresh.task_id, { type: "dispose", timestamp: nowIso(context) })
      return {
        task_id: fresh.task_id,
        kind: "resumed",
        reason: "terminal without transcript disposed; persisted result preserved",
      }
    }
    await markLost(context, fresh, "record has neither a session transcript nor a persisted v1 spawn spec")
    return { task_id: fresh.task_id, kind: "lost", reason: "spawn spec unavailable" }
  }

  const ports = context.reattachPorts ?? getLifecycleReattachPorts(context.store)
  if (ports === undefined) {
    await markLost(context, fresh, "reattach ports unavailable")
    return { task_id: fresh.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const reservation = ports.reserve(fresh)
  if (!reservation.ok) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "capacity")
  let respawned: Awaited<ReturnType<typeof ports.respawn>>
  try {
    respawned = await ports.respawn(fresh, sessionPath)
  } catch (error) {
    reservation.release()
    throw error
  }
  if (!respawned.ok) {
    reservation.release()
    if (respawned.disposition === "retryable") {
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code))
    }
    if (TERMINAL_STATUSES.has(fresh.status)) {
      context.store.transition(fresh.task_id, { type: "dispose", timestamp: nowIso(context) })
      return { task_id: fresh.task_id, kind: "resumed", reason: respawned.reason }
    }
    await markLost(context, fresh, `reattach failed: ${respawned.reason}`)
    return { task_id: fresh.task_id, kind: "lost", reason: respawned.reason }
  }

  let reattached: Awaited<ReturnType<typeof ports.reattach>>
  try {
    reattached = await ports.reattach(fresh, respawned.handle)
  } catch (error) {
    reservation.release()
    throw error
  }
  if (!reattached.ok) {
    reservation.release()
    if (reattached.kind === "already_attached") {
      return { task_id: fresh.task_id, kind: "resumed", reason: reattached.reason }
    }
    return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
  }
  context.store.appendEvent(fresh.task_id, {
    type: "reconcile_reattached",
    payload: sessionPath === undefined ? { fresh_launch: true } : { session_path: sessionPath },
  })
  return { task_id: fresh.task_id, kind: "resumed", reason: "respawned and reattached" }
}

async function terminateOldRpc(context: LifecycleContext, record: TaskRecord): Promise<boolean> {
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

function rollbackOrDeferred(
  context: LifecycleContext,
  taskId: string,
  residency: SuspendedResidency,
  successReason: ReconcileDeferredReason,
): ReconcileOutcome {
  return rollbackClaim(context, taskId, residency)
    ? deferred(taskId, successReason)
    : deferred(taskId, "rollback_failed")
}

function rollbackClaim(context: LifecycleContext, taskId: string, residency: SuspendedResidency): boolean {
  try {
    context.store.mutate(taskId, (fresh) => {
      if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident") return fresh
      const { host_pid: _hostPid, ...withoutHost } = fresh
      if (residency === "rpc_detached") {
        return { ...withoutHost, residency_state: residency, updated_at: nowIso(context) }
      }
      const { pid: _pid, ...withoutPid } = withoutHost
      return { ...withoutPid, residency_state: residency, updated_at: nowIso(context) }
    })
    return true
  } catch (error) {
    log("senpi-task reconcile ownership rollback failed", { taskId, residency, error: String(error) })
    return false
  }
}

async function markLost(context: LifecycleContext, record: TaskRecord, message: string): Promise<void> {
  let applied = false
  context.store.mutate(record.task_id, (fresh) => {
    if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident") return fresh
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

export function isOrphan(context: LifecycleContext, record: TaskRecord): boolean {
  if (record.host_pid === context.hostPid) return !hasLiveHandle(context, record.task_id)
  return record.host_pid === undefined || !context.signaller.isAlive(record.host_pid)
}

function hasLiveHandle(context: LifecycleContext, taskId: string): boolean {
  return context.registry.get(taskId) !== undefined || context.registry.entries().some((handle) => handle.task_id === taskId)
}

export function isClaimHeld(
  context: LifecycleContext,
  record: TaskRecord | null,
  parentSessionId: string,
): record is TaskRecord {
  return record !== null && record.parent_session_id === parentSessionId &&
    record.residency_state === "resident" && record.host_pid === context.hostPid
}

function isSpawnSpecV1Record(record: TaskRecord): boolean {
  return record.spawn_spec !== undefined && isSpawnSpecV1(record.spawn_spec)
}

function deferredCode(code: RespawnFailureCode): ReconcileDeferredReason {
  return code === "respawn_failed" ? "session_unavailable" : code
}

export function beginLocalReclamation(context: LifecycleContext, taskId: string): (() => void) | undefined {
  const key = `${context.store.stateDir}\u0000${taskId}`
  if (activeLocalReclamations.has(key)) return undefined
  activeLocalReclamations.add(key)
  return () => activeLocalReclamations.delete(key)
}

export function deferred(taskId: string, reason: ReconcileDeferredReason): ReconcileOutcome {
  return { task_id: taskId, kind: "deferred", reason }
}
