import type { TaskRecord } from "../state"
import { isSpawnSpecV1 } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { hostSessionResumePath, isHostSessionRecord } from "./host-session"
import { clearSuspensionReason, markSuspensionReason } from "./host-session-record"
import { detachTerminalResident } from "./reconcile-terminal"
import { getLifecycleReattachPorts, type RespawnFailureCode, type RespawnPort, type RespawnResult } from "./port"
import { markCrashedResident } from "./reconcile-crashed-resident"
import { reclaimOrphanedResident } from "./residency"
import { deferred, markLost, rollbackOrDeferred, terminateOldRpc, type SuspendedResidency } from "./revive-rollback"
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
    // Never respawned - but deferring left the record non-terminal, and crash salvage only visits
    // terminal records, so the sweep in the same startup pass reclaimed the clone with the child's
    // unreviewed delta still inside it. Marking it lost is what the legacy respawn path already does.
    await markLost(context, claimed, "isolated record is never respawned")
    return { task_id: claimed.task_id, kind: "lost", reason: "isolated_not_revivable" }
  }
  const fresh = context.store.load(claimed.task_id)
  const terminalAllowed = options.allowTerminal === true && fresh !== null && TERMINAL_STATUSES.has(fresh.status)
  // A daemon-hosted child resumes its RECORDED session path: the daemon, not the disk, owns the
  // live transcript, so a directory scan can name the wrong file (or nothing at all).
  const resumePath = hostSessionResumePath(fresh) ?? sessionPath
  if (!isClaimHeld(context, fresh, claimed.parent_session_id) || fresh.killed === true || (!REVIVABLE_STATUSES.has(fresh?.status ?? "pending") && !terminalAllowed)) {
    return rollbackOrDeferred(context, claimed.task_id, rollbackResidency, "foreign_live_owner")
  }

  // A host session has no pid of its own; only the child-process runner ever leaves one behind.
  if (fresh.execution_mode === "process" && fresh.pid !== undefined && !isHostSessionRecord(fresh)) {
    const terminated = await terminateOldRpc(context, fresh)
    if (!terminated) {
      return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
    }
  }

  if (isHostSessionRecord(fresh) && !(await context.hostSessionProbe.daemonAlive(fresh.host_session))) {
    const outcome = rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "host_unreachable")
    markSuspensionReason(context, fresh.task_id, "daemon_unavailable")
    return outcome
  }

  if (resumePath === undefined && !isSpawnSpecV1Record(fresh)) {
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
    if (TERMINAL_STATUSES.has(fresh.status)) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
    await markLost(context, fresh, "reattach ports unavailable")
    return { task_id: fresh.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const reservation = ports.reserve(fresh)
  if (!reservation.ok) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "capacity")
  let respawned: Awaited<ReturnType<typeof ports.respawn>>
  try {
    respawned = await respawnThroughDrain(context, ports.respawn, fresh, resumePath)
  } catch (error) {
    reservation.release()
    if (terminalAllowed) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
    throw error
  }
  if (!respawned.ok) {
    reservation.release()
    if (respawned.disposition === "retryable") {
      const outcome = rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code))
      if (respawned.code === "host_draining") markSuspensionReason(context, fresh.task_id, "host_draining")
      return outcome
    }
    if (TERMINAL_STATUSES.has(fresh.status) && options.rollbackTerminalFailure !== true) {
      context.store.transition(fresh.task_id, { type: "dispose", timestamp: nowIso(context) })
      return { task_id: fresh.task_id, kind: "resumed", reason: respawned.reason }
    }
    if (TERMINAL_STATUSES.has(fresh.status)) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, deferredCode(respawned.code))
    await markLost(context, fresh, `reattach failed: ${respawned.reason}`)
    return { task_id: fresh.task_id, kind: "lost", reason: respawned.reason }
  }

  let reattached: Awaited<ReturnType<typeof ports.reattach>>
  try {
    reattached = await ports.reattach(fresh, respawned.handle)
  } catch (error) {
    reservation.release()
    if (terminalAllowed) return rollbackOrDeferred(context, fresh.task_id, rollbackResidency, "session_unavailable")
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
