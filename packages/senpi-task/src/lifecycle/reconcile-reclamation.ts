import type { TaskRecord } from "../state"
import { isSpawnSpecV1 } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { endClosingFallbackChild } from "./fallback-closing-child"
import { isFallbackHandoff } from "./fallback-handoff"
import { parkedReason, reachRecordedHost } from "./host-endpoint-reach"
import { hostSessionResumePath, isHostSessionRecord } from "./host-session"
import { clearSuspensionReason, markSuspensionReason } from "./host-session-record"
import { detachTerminalResident } from "./reconcile-terminal"
import { getLifecycleReattachPorts, type RespawnFailureCode, type RespawnPort, type RespawnResult } from "./port"
import { markCrashedResident } from "./reconcile-crashed-resident"
import { finishPendingCancel } from "./pending-cancel"
import { reclaimOrphanedResident } from "./residency"
import { deferred, disposeClaimed, markLost, rollbackOrDeferred, terminateOldRpc, type SuspendedResidency } from "./revive-rollback"
import type { ReconcileDeferredReason, ReconcileOutcome } from "./types"

export { deferred } from "./revive-rollback"
export type { SuspendedResidency } from "./revive-rollback"

export const REVIVABLE_STATUSES = new Set(["pending", "running", "interrupted"])
const activeLocalReclamations = new Set<string>()

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
  // A daemon-hosted child names its transcript on the record; the disk scan only knows the child's
  // own session dir, so preferring the record keeps a parked session from reading as transcript-less.
  const sessionPath = hostSessionResumePath(claimed) ?? sessionPathFor(claimed.task_id)
  if (TERMINAL_STATUSES.has(claimed.status) && sessionPath === undefined) {
    context.store.transition(claimed.task_id, { type: "dispose", timestamp: nowIso(context) })
    return {
      task_id: claimed.task_id,
      kind: "resumed",
      reason: "terminal without transcript disposed; persisted result preserved",
    }
  }
  if (TERMINAL_STATUSES.has(claimed.status)) return detachTerminalResident(context, claimed)
  if (!REVIVABLE_STATUSES.has(claimed.status)) {
    await destroyResidentTask(context, claimed.task_id, "reconcile_lost")
    return { task_id: claimed.task_id, kind: "resumed", reason: "non-revivable orphan disposed" }
  }
  const rollbackResidency: SuspendedResidency = claimed.execution_mode === "process" ? "rpc_detached" : "persisted_only"
  if (context.config.reattach_on_reconcile === false) {
    const marked = await markCrashedResident(context, claimed, "reattach disabled for crashed resident")
    if (marked) await destroyResidentTask(context, claimed.task_id, "reconcile_lost")
    return { task_id: claimed.task_id, kind: "lost", reason: "reattach disabled for crashed resident" }
  }
  return reviveClaimed(context, claimed, rollbackResidency, sessionPath)
}

export type ReviveClaimedOptions = {
  readonly allowTerminal?: boolean
  readonly rollbackTerminalFailure?: boolean
}

export async function reviveClaimed(
  context: LifecycleContext,
  claimed: TaskRecord,
  rollbackResidency: SuspendedResidency,
  sessionPath: string | undefined,
  options: ReviveClaimedOptions = {},
): Promise<ReconcileOutcome> {
  if (claimed.isolation !== undefined) {
    if (context.deferUnresumable)
      return rollbackOrDeferred(context, claimed.task_id, rollbackResidency, "isolated_not_revivable", claimed)
    // Never respawned - but deferring left the record non-terminal, and crash salvage only visits
    // terminal records, so the sweep in the same startup pass reclaimed the clone with the child's
    // unreviewed delta still inside it. Marking it lost is what the legacy respawn path already does.
    await markLost(context, claimed, "isolated record is never respawned")
    return { task_id: claimed.task_id, kind: "lost", reason: "isolated_not_revivable" }
  }
  const fresh = context.store.load(claimed.task_id)
  const terminalAllowed = options.allowTerminal === true && fresh !== null && TERMINAL_STATUSES.has(fresh.status)
  // A daemon-hosted child resumes its RECORDED session path: the daemon, not the disk, owns the
  // live transcript, so a directory scan can name the wrong file (or nothing at all). A fallback
  // handoff resumes nothing: its newest transcript is the failed rung's, so it launches fresh.
  const resumePath = isFallbackHandoff(fresh) ? undefined : hostSessionResumePath(fresh) ?? sessionPath
  if (!isClaimHeld(context, fresh, claimed.parent_session_id) || fresh.killed === true || (!REVIVABLE_STATUSES.has(fresh?.status ?? "pending") && !terminalAllowed)) {
    return rollbackOrDeferred(context, claimed.task_id, rollbackResidency, "foreign_live_owner", claimed)
  }
  // A host session has no pid of its own; only the child-process runner ever leaves one behind. A
  // previous process's child is ended first, a cancelled one included: finishing a cancel never leaves
  // its process running.
  if (fresh.execution_mode === "process" && fresh.pid !== undefined && !isHostSessionRecord(fresh)) {
    const terminated = await terminateOldRpc(context, fresh)
    if (!terminated) {
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
    }
  }

  // An accepted cancel is final: this claim finishes it rather than running the child again. A host
  // that does not confirm the session closed leaves the cancel pending for the next revival.
  if (fresh.cancel_requested !== undefined && !TERMINAL_STATUSES.has(fresh.status)) {
    const finished = await finishPendingCancel(context, fresh)
    return finished ?? rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "host_unreachable", fresh)
  }

  if (!(await endClosingFallbackChild(context, fresh))) {
    return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
  }
  // Everything above awaited: a stop or another owner that landed meanwhile ends this revival here.
  if (!isSameClaim(context, fresh)) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "foreign_live_owner", fresh)

  const reached = isHostSessionRecord(fresh) ? await reachRecordedHost(context, fresh.host_session) : "alive"
  if (reached !== "alive") {
    const outcome = rollbackOrDeferred(context, fresh.task_id, rollbackResidency, reached, fresh)
    markSuspensionReason(context, fresh.task_id, parkedReason(reached))
    return outcome
  }
  if (context.deferUnresumable && !terminalAllowed && fresh.fallback_handoff_epoch !== fresh.notification.run_epoch
    && ((resumePath === undefined && fresh.started_at !== undefined)
      || (fresh.execution_mode === "in-process" && !isSpawnSpecV1Record(fresh)))) {
    const reason = resumePath === undefined ? "transcript_unavailable" : "spawn_spec_unavailable"
    return { ...rollbackOrDeferred(context, fresh.task_id, rollbackResidency, reason, fresh), permanent: true }
  }

  if (resumePath === undefined && !isSpawnSpecV1Record(fresh)) {
    if (context.deferUnresumable)
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "spawn_spec_unavailable", fresh)
    if (TERMINAL_STATUSES.has(fresh.status)) {
      disposeClaimed(context, fresh)
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
    if (context.deferUnresumable)
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
    if (TERMINAL_STATUSES.has(fresh.status)) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
    await markLost(context, fresh, "reattach ports unavailable")
    return { task_id: fresh.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const reservation = ports.reserve(fresh)
  if (!reservation.ok) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "capacity", fresh)
  let respawned: Awaited<ReturnType<typeof ports.respawn>>
  try {
    respawned = await respawnThroughDrain(context, ports.respawn, fresh, resumePath)
  } catch (error) {
    reservation.release()
    if (terminalAllowed || context.deferUnresumable) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
    throw error
  }
  if (!respawned.ok) {
    reservation.release()
    if (respawned.disposition === "retryable") {
      const outcome = rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code), fresh)
      if (isSuspendingCode(respawned.code)) markSuspensionReason(context, fresh.task_id, respawned.code)
      return outcome
    }
    if (TERMINAL_STATUSES.has(fresh.status) && options.rollbackTerminalFailure !== true) {
      disposeClaimed(context, fresh)
      return { task_id: fresh.task_id, kind: "resumed", reason: respawned.reason }
    }
    if (TERMINAL_STATUSES.has(fresh.status)) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code), fresh)
    if (context.deferUnresumable)
      return { ...rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code), fresh), permanent: true }
    await markLost(context, fresh, `reattach failed: ${respawned.reason}`)
    return { task_id: fresh.task_id, kind: "lost", reason: respawned.reason }
  }

  let reattached: Awaited<ReturnType<typeof ports.reattach>>
  try {
    reattached = await ports.reattach(fresh, respawned.handle)
  } catch (error) {
    reservation.release()
    if (terminalAllowed || context.deferUnresumable) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
    throw error
  }
  if (!reattached.ok) {
    reservation.release()
    if (reattached.kind === "already_attached") {
      return { task_id: fresh.task_id, kind: "resumed", reason: reattached.reason }
    }
    return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable", fresh)
  }
  context.store.appendEvent(fresh.task_id, {
    type: "reconcile_reattached",
    payload: resumePath === undefined ? { fresh_launch: true } : { session_path: resumePath },
  })
  clearSuspensionReason(context, fresh.task_id)
  return { task_id: fresh.task_id, kind: "resumed", reason: "respawned and reattached" }
}

/**
 * A generation that is still draining after a handoff answers `session_path_in_use`. That is a WAIT,
 * not a failure: retry on the host's own `retryAfterMs` (2 s when it names none) up to the attempt
 * budget, then defer as `host_draining`. The child is never lost and the session is never opened
 * twice - every attempt starts from a rejected open.
 */
async function respawnThroughDrain(
  context: LifecycleContext,
  respawn: RespawnPort,
  record: TaskRecord,
  sessionPath: string | undefined,
): Promise<RespawnResult> {
  const { maxDrainAttempts, defaultRetryAfterMs, wait } = context.hostRetry
  let result = await respawn(record, sessionPath)
  for (let attempt = 1; attempt < maxDrainAttempts; attempt += 1) {
    if (result.ok || result.code !== "host_draining") return result
    await wait(result.retryAfterMs ?? defaultRetryAfterMs)
    result = await respawn(record, sessionPath)
  }
  return result
}

function isSameClaim(context: LifecycleContext, claimed: TaskRecord): boolean {
  const now = context.store.load(claimed.task_id)
  return isClaimHeld(context, now, claimed.parent_session_id)
    && now.killed !== true
    && now.status === claimed.status
    && now.notification.run_epoch === claimed.notification.run_epoch
    && now.residency_claim === claimed.residency_claim
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

function isSuspendingCode(code: RespawnFailureCode): code is "host_draining" | "host_incompatible" | "store_index_unavailable" {
  return code === "host_draining" || code === "host_incompatible" || code === "store_index_unavailable"
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
