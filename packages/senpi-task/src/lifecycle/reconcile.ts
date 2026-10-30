import { log } from "@oh-my-opencode/utils"

import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { withDroppedSteeringNotice } from "../state/queued-steering"
import { nowIso, reconciliationActive, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { isFallbackHandoff } from "./fallback-handoff"
import { isHostSessionRecord } from "./host-session"
import { reconcileHostSessionOrphan } from "./host-session-revive"
import { reviveClaimed } from "./reconcile-reclamation"
import { reclaimIsolations } from "./reclaim-isolations"
import { getLifecycleReattachPorts } from "./port"
import { beginLocalReclamation, reconcileScopedRevival } from "./reconcile-revival"
import { reclaimOrphanedResident } from "./residency"
import { newestSessionPath } from "./session-path"
import { reconcileLegacyTerminal, terminateClaimedPid } from "./reconcile-terminal"
import type { ReconcileOutcome, ReconcileResult } from "./types"
import { reconcileProvisionalExit, settleProvisionalExitLoss } from "./provisional-exit"
import { hasForeignLiveOwner } from "./reconcile-owner"
import { holdsClaim, rollbackOrDeferred } from "./revive-rollback"
import { suspendHandle } from "./shutdown"

const HEARTBEAT_FRESH_MS = 30_000

/** Reconcile persisted task records with handles and processes visible to this session. */
export async function reconcileOnSessionStart(
  context: LifecycleContext,
  parentSessionId?: string,
): Promise<ReconcileResult> {
  if (!reconciliationActive(context)) return { outcomes: [] }
  context.hostSessionProbe.refresh()
  const groups = new Map<string, TaskRecord[]>()
  for (const record of context.store.list().records) {
    const key = isHostSessionRecord(record) ? record.host_session.socket : ""
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  // Admission leases cover only local claims. A host's probe/respawn never holds up another host.
  const results = await Promise.all([...groups.values()].map(records => reconcileRecords(context, parentSessionId, records)))
  if (!reconciliationActive(context)) return { outcomes: [] }
  await reclaimIsolations(context)
  return { outcomes: results.flatMap(result => result.outcomes) }
}

async function reconcileRecords(
  context: LifecycleContext,
  parentSessionId: string | undefined,
  records: readonly TaskRecord[],
): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  const candidates: TaskRecord[] = []
  const excludedFromRevival = new Set(context.reconcileAdmission.excludeTaskIds)

  // Ownership is checked before terminality, residency, or mode. A live sibling owns the record in
  // every status and this process must not mutate it.
  for (const record of records) {
    if (!reconciliationActive(context)) return { outcomes }
    const foreign = await hasForeignLiveOwner(context, record, parentSessionId)
    if (!reconciliationActive(context)) return { outcomes }
    // The probe says nothing about a claim installed while it was in flight, even at the same pid.
    const fresh = context.store.load(record.task_id)
    if (fresh === null || fresh.host_pid !== record.host_pid || fresh.residency_claim !== record.residency_claim
      || fresh.notification.run_epoch !== record.notification.run_epoch || fresh.updated_at !== record.updated_at
      || fresh.residency_state !== record.residency_state || fresh.status !== record.status) {
      excludedFromRevival.add(record.task_id)
      outcomes.push(ownedElsewhere(record.task_id, parentSessionId, "ownership changed during probe"))
      continue
    }
    if (foreign) {
      // Scoped admission re-reads the store rather than this candidate array. Carry the
      // ownership exclusion into that selector too, or a suspended live-owner child is claimed.
      excludedFromRevival.add(record.task_id)
      outcomes.push(ownedElsewhere(record.task_id, parentSessionId, `child owned by live process pid=${record.host_pid}`))
      continue
    }
    if (hasLiveResidentHandle(context, record.task_id)) {
      // Each retry can wait out a full request deadline; never hold session start on it.
      if (record.uncertain_inputs !== undefined) {
        void context.registry.get(record.task_id)?.reconcileInputs?.()
          ?.catch((error: unknown) => log("senpi-task uncertain input reconcile failed", { taskId: record.task_id, error: String(error) }))
      }
      outcomes.push({ task_id: record.task_id, kind: "resumed", reason: "owned by this process" })
      continue
    }
    if (record.provisional_exit !== undefined && !TERMINAL_STATUSES.has(record.status)
      && !(parentSessionId !== undefined && record.parent_session_id !== parentSessionId && isSameProcessSibling(context, record))) {
      outcomes.push(await reconcileProvisionalExit(context, record))
      if (!reconciliationActive(context)) return { outcomes }
      excludedFromRevival.add(record.task_id)
      continue
    }
    candidates.push(record)
  }

  if (parentSessionId === undefined) {
    for (const record of candidates) {
      if (isSuspended(record)) continue
      outcomes.push(await reconcileLegacyRecord(context, record))
      if (!reconciliationActive(context)) return { outcomes }
    }
    return { outcomes }
  }

  // Preserve the pre-feature global crash sweep for legacy resident orphans of OTHER sessions.
  // Suspended records are intentionally excluded: scoped revival may only target parentSessionId.
  for (const record of candidates) {
    if (record.parent_session_id === parentSessionId || record.residency_state !== "resident") continue
    // A multi-session host (one shared process, one engine + registry PER session) reaches this
    // loop for every sibling session's children. Such a record carries THIS host_pid yet is absent
    // from this session's registry, which is indistinguishable from a crashed-process orphan by
    // host_pid alone - and reclaiming it kills a live sibling child (an in-process record is marked
    // lost outright). Ownership by a live session in this process is the sibling's to resolve, so
    // defer instead of sweeping. The global sweep below keeps the single-session crash semantics.
    if (isSameProcessSibling(context, record)) {
      outcomes.push({ task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" })
      continue
    }
    outcomes.push(await reconcileLegacyRecord(context, record))
    if (!reconciliationActive(context)) return { outcomes }
  }

  const approved = new Set(candidates.map(record => record.task_id))
  outcomes.push(...await reconcileScopedRevival(
    {
      ...context,
      deferUnresumable: context.registry.ownsRecord?.({ parent_session_id: parentSessionId }) === true || context.deferUnresumable,
      reconcileAdmission: {
        ...context.reconcileAdmission,
        excludeTaskIds: excludedFromRevival,
        canClaim: (fresh) => approved.has(fresh.task_id) && context.reconcileAdmission.canClaim?.(fresh) !== false,
      },
    },
    parentSessionId,
    candidates.filter((record) => record.parent_session_id === parentSessionId),
    (taskId) => newestSessionPath(context, taskId),
  ))
  return { outcomes }
}

// A scoped pass that loses a record to another owner defers it, wherever it lost the race: the
// deferral is what arms its fenced retry should that owner die. The legacy sweep only reports.
function ownedElsewhere(taskId: string, parentSessionId: string | undefined, legacyReason: string): ReconcileOutcome {
  return parentSessionId === undefined
    ? { task_id: taskId, kind: "foreign_live_owner", reason: legacyReason }
    : { task_id: taskId, kind: "deferred", reason: "foreign_live_owner" }
}

export async function reconcileLegacyRecord(context: LifecycleContext, observed: TaskRecord): Promise<ReconcileOutcome> {
  if (!reconciliationActive(context)) return { task_id: observed.task_id, kind: "deferred", reason: "session_unavailable" }
  if (observed.residency_state !== "resident") return reconcileLegacyRecordExclusive(context, observed)
  // Same-process sweeps cannot distinguish "our claim is in flight" from a switched-session orphan
  // using host_pid alone. This marker never waits or spans records: a loser defers immediately while
  // all process I/O remains outside the admission lease.
  const release = beginLocalReclamation(context, observed.task_id)
  if (release === undefined) {
    return { task_id: observed.task_id, kind: "foreign_live_owner", reason: "orphan ownership claim in flight" }
  }
  try {
    return await reconcileLegacyRecordExclusive(context, observed)
  } finally {
    release()
  }
}

async function reconcileLegacyRecordExclusive(context: LifecycleContext, observed: TaskRecord): Promise<ReconcileOutcome> {
  let record = observed
  if (record.residency_state === "resident") {
    try {
      if (reclaimOrphanedResident(context, observed) !== "claimed") {
        return {
          task_id: observed.task_id,
          kind: "foreign_live_owner",
          reason: "orphan ownership claim lost",
        }
      }
    } catch {
      return {
        task_id: observed.task_id,
        kind: "foreign_live_owner",
        reason: "orphan ownership lock contended",
      }
    }
    record = context.store.load(record.task_id) ?? record
  }

  if (TERMINAL_STATUSES.has(record.status)) return reconcileLegacyTerminal(context, record)
  if (record.provisional_exit !== undefined) return settleProvisionalExitLoss(context, record)

  // A daemon-hosted child has no pid at all. Its liveness is the daemon plus its session path, and
  // "the daemon is gone" parks it - the pid-shaped path below would mark it lost for having no pid.
  if (isHostSessionRecord(record)) return reconcileHostSessionOrphan(context, record)

  if (record.execution_mode !== "process") {
    await markLost(context, record.task_id, "in-process task from a previous process cannot be reattached")
    return { task_id: record.task_id, kind: "lost", reason: "previous-process in-process" }
  }

  const pid = record.pid
  if (pid === undefined) {
    // A runtime-fallback handoff whose owner died is revived onto its selected next model; any other
    // pid-less child (queued, or a workpool worker that may never be replayed) has nothing to revive.
    if (isFallbackHandoff(record) && context.config.reattach_on_reconcile !== false) {
      return reviveClaimed(context, record, "rpc_detached", undefined)
    }
    await markLost(context, record.task_id, "rpc task had no recorded pid")
    return { task_id: record.task_id, kind: "lost", reason: "no recorded pid" }
  }

  const alive = context.signaller.isAlive(pid)
  if (context.config.reattach_on_reconcile === false) {
    if (!alive) {
      await markLost(context, record.task_id, `rpc pid=${pid} is dead; mapping exit facts only`)
      return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
    }
    const heartbeat = heartbeatState(context, record)
    await markLost(
      context,
      record.task_id,
      `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; reattach disabled, terminating orphan`,
    )
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }

  const sessionPath = newestSessionPath(context, record.task_id)
  if (!alive) {
    if (sessionPath !== undefined) return reattachLegacyRecord(context, record, sessionPath)
    await markLost(context, record.task_id, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }

  const heartbeat = heartbeatState(context, record)
  const terminated = await terminateClaimedPid(context, record)
  if (!reconciliationActive(context)) return rollbackOrDeferred(context, record.task_id, "rpc_detached", "session_unavailable", record)
  const fresh = context.store.load(record.task_id)
  if (fresh === null || !holdsClaim(context, fresh, record)) return { task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" }
  if (!terminated) {
    await markLost(context, record.task_id, `rpc orphan pid=${pid} could not be terminated`)
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  if (sessionPath === undefined) {
    await markLost(
      context,
      record.task_id,
      `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; terminating before reattach`,
    )
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  return reattachLegacyRecord(context, context.store.load(record.task_id) ?? record, sessionPath)
}

async function reattachLegacyRecord(
  context: LifecycleContext,
  record: TaskRecord,
  sessionPath: string,
): Promise<ReconcileOutcome> {
  // The legacy process path reserves and respawns directly, so the reviveClaimed guard never sees
  // it: an isolated record must be stopped HERE or it is relaunched inside a reclaimed clone.
  if (record.isolation !== undefined) {
    await markLost(context, record.task_id, "isolated record is never respawned")
    return { task_id: record.task_id, kind: "lost", reason: "isolated_not_revivable" }
  }
  const ports = context.reattachPorts ?? getLifecycleReattachPorts(context.store)
  if (ports === undefined) {
    await markLost(context, record.task_id, "reattach ports unavailable")
    return { task_id: record.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const reservation = ports.reserve(record)
  if (!reservation.ok) return { task_id: record.task_id, kind: "deferred", reason: "capacity" }
  let respawned: Awaited<ReturnType<typeof ports.respawn>>
  try {
    respawned = await ports.respawn(record, sessionPath)
  } catch (error) {
    reservation.release()
    throw error
  }
  const owns = () => {
    const fresh = context.store.load(record.task_id)
    return fresh !== null && fresh.host_pid === context.hostPid && fresh.residency_claim === record.residency_claim
  }
  if (!reconciliationActive(context) || !owns()) {
    reservation.release()
    if (respawned.ok) {
      const handle = respawned.handle
      await suspendHandle(context, {
        ...handle, kind: handle.kind ?? "rpc",
        terminate: () => handle.terminate?.() ?? Promise.resolve(),
      }, "revived_after_shutdown", owns)
    }
    return rollbackOrDeferred(context, record.task_id, "rpc_detached", "session_unavailable", record)
  }
  if (!respawned.ok) {
    reservation.release()
    // A stopped run keeps its child: nothing launched, and the run's Resume restores it.
    if (respawned.code === "run_paused") return { task_id: record.task_id, kind: "deferred", reason: "run_paused" }
    await markLost(context, record.task_id, `reattach failed: ${respawned.reason}`)
    return { task_id: record.task_id, kind: "lost", reason: respawned.reason }
  }
  let reattached: Awaited<ReturnType<typeof ports.reattach>>
  try {
    reattached = await ports.reattach(record, respawned.handle, respawned.ok ? respawned.awaitingInput : undefined)
  } catch (error) {
    reservation.release()
    throw error
  }
  if (!reconciliationActive(context) || !owns()) {
    reservation.release()
    if (reattached.ok) {
      const handle = respawned.handle
      await suspendHandle(context, {
        ...handle, kind: handle.kind ?? "rpc",
        terminate: () => handle.terminate?.() ?? Promise.resolve(),
      }, "revived_after_shutdown", owns)
    }
    return rollbackOrDeferred(context, record.task_id, "rpc_detached", "session_unavailable", record)
  }
  if (!reattached.ok) {
    reservation.release()
    if (reattached.kind === "already_attached") {
      return { task_id: record.task_id, kind: "resumed", reason: reattached.reason }
    }
    await markLost(context, record.task_id, reattached.reason)
    return { task_id: record.task_id, kind: "lost", reason: reattached.reason }
  }
  context.store.appendEvent(record.task_id, { type: "reconcile_reattached", payload: { session_path: sessionPath } })
  return { task_id: record.task_id, kind: "resumed", reason: "respawned and reattached" }
}

// A record stamped with THIS host pid that reached the candidate list is owned by another engine in
// this process (this session's registry has no handle for it): a sibling session of a multi-session
// host. Records with no host_pid or a dead foreign owner are NOT siblings and stay sweepable.
function isSameProcessSibling(context: LifecycleContext, record: TaskRecord): boolean {
  return record.host_pid === context.hostPid
}

function hasLiveResidentHandle(context: LifecycleContext, taskId: string): boolean {
  return context.registry.get(taskId) !== undefined || context.registry.entries().some((handle) => handle.task_id === taskId)
}

function isSuspended(record: TaskRecord): boolean {
  return record.residency_state === "persisted_only" || record.residency_state === "rpc_detached"
}

function heartbeatState(context: LifecycleContext, record: TaskRecord): "fresh" | "stale" {
  return context.now() - Date.parse(record.updated_at) < HEARTBEAT_FRESH_MS ? "fresh" : "stale"
}

async function markLost(context: LifecycleContext, taskId: string, message: string): Promise<void> {
  let applied = false
  // Respawn can persist launch evidence before failing. Reduce the current record under its
  // lock, never the candidate captured before process I/O or a failed reattachment.
  const record = context.store.mutate(taskId, (fresh) => {
    const result = markRecordLostForReconciliation(fresh, {
      timestamp: nowIso(context),
      error_message: withDroppedSteeringNotice(message, fresh.pending_steering?.length ?? 0),
      updateReason: fresh.status === "lost",
    })
    applied = result.applied
    return result.record
  })
  if (applied) {
    context.store.appendEvent(taskId, { type: "reconcile_lost", payload: { reason: message } })
  }
  if (record?.residency_state === "resident") await destroyResidentTask(context, taskId, "target_gone")
  else if (applied) context.registry.forget(taskId, { path: "end" })
}

// Startup order is load-bearing: records are reconciled FIRST so a crashed child is terminal, then
// its delta is salvaged while the clone still exists, and only then may the sweep reclaim clones
// whose owner is provably gone. Reversing salvage and sweep would delete unreviewed work.
