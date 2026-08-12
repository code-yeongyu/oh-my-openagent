import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { delay, nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { getLifecycleReattachPorts } from "./port"
import { beginLocalReclamation, reconcileScopedRevival } from "./reconcile-revival"
import { reclaimOrphanedResident } from "./residency"
import type { ReconcileOutcome, ReconcileResult } from "./types"

const HEARTBEAT_FRESH_MS = 30_000

/** Reconcile persisted task records with handles and processes visible to this session. */
export async function reconcileOnSessionStart(
  context: LifecycleContext,
  parentSessionId?: string,
): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  const candidates: TaskRecord[] = []

  // Ownership is checked before terminality, residency, or mode. A live sibling owns the record in
  // every status and this process must not mutate it.
  for (const record of context.store.list().records) {
    if (hasForeignLiveOwner(context, record)) {
      outcomes.push(parentSessionId === undefined
        ? {
            task_id: record.task_id,
            kind: "foreign_live_owner",
            reason: `child owned by live process pid=${record.host_pid}`,
          }
        : { task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" })
      continue
    }
    if (hasLiveResidentHandle(context, record.task_id)) {
      outcomes.push({ task_id: record.task_id, kind: "resumed", reason: "owned by this process" })
      continue
    }
    candidates.push(record)
  }

  if (parentSessionId === undefined) {
    for (const record of candidates) {
      if (isSuspended(record)) continue
      outcomes.push(await reconcileLegacyRecord(context, record))
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
  }

  outcomes.push(...await reconcileScopedRevival(
    context,
    parentSessionId,
    candidates.filter((record) => record.parent_session_id === parentSessionId),
    (taskId) => newestSessionPath(context, taskId),
  ))
  return { outcomes }
}

async function reconcileLegacyRecord(context: LifecycleContext, observed: TaskRecord): Promise<ReconcileOutcome> {
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

  if (record.execution_mode !== "process") {
    await markLost(context, record, "in-process task from a previous process cannot be reattached")
    return { task_id: record.task_id, kind: "lost", reason: "previous-process in-process" }
  }

  const pid = record.pid
  if (pid === undefined) {
    await markLost(context, record, "rpc task had no recorded pid")
    return { task_id: record.task_id, kind: "lost", reason: "no recorded pid" }
  }

  const alive = context.signaller.isAlive(pid)
  if (context.config.reattach_on_reconcile === false) {
    if (!alive) {
      await markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
      return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
    }
    const heartbeat = heartbeatState(context, record)
    await markLost(
      context,
      record,
      `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; reattach disabled, terminating orphan`,
    )
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }

  const sessionPath = newestSessionPath(context, record.task_id)
  if (!alive) {
    if (sessionPath !== undefined) return reattachLegacyRecord(context, record, sessionPath)
    await markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }

  const heartbeat = heartbeatState(context, record)
  if (!await terminateClaimedPid(context, record)) {
    await markLost(context, record, `rpc orphan pid=${pid} could not be terminated`)
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  if (sessionPath === undefined) {
    await markLost(
      context,
      record,
      `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; terminating before reattach`,
    )
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  return reattachLegacyRecord(context, context.store.load(record.task_id) ?? record, sessionPath)
}

async function reconcileLegacyTerminal(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (record.status === "lost" || record.status === "cancelled") {
    if (record.residency_state === "resident") await destroyResidentTask(context, record.task_id, "reconcile_lost")
    return { task_id: record.task_id, kind: record.status === "lost" ? "lost" : "resumed", reason: `already ${record.status}` }
  }
  const pid = record.pid
  if (record.execution_mode !== "process" || record.residency_state !== "resident" || pid === undefined) {
    return { task_id: record.task_id, kind: "resumed" }
  }

  const alive = context.signaller.isAlive(pid)
  const sessionPath = newestSessionPath(context, record.task_id)
  if (alive) {
    await terminateClaimedPid(context, record)
    if (sessionPath === undefined || context.config.reattach_on_reconcile === false) {
      await destroyResidentTask(context, record.task_id, "reconcile_lost")
      return { task_id: record.task_id, kind: "lost_and_terminated", reason: `terminal resident orphan pid ${pid}` }
    }
    return reattachLegacyRecord(context, context.store.load(record.task_id) ?? record, sessionPath)
  }
  if (sessionPath !== undefined && context.config.reattach_on_reconcile !== false) {
    return reattachLegacyRecord(context, record, sessionPath)
  }
  return { task_id: record.task_id, kind: "resumed" }
}

async function reattachLegacyRecord(
  context: LifecycleContext,
  record: TaskRecord,
  sessionPath: string,
): Promise<ReconcileOutcome> {
  const ports = context.reattachPorts ?? getLifecycleReattachPorts(context.store)
  if (ports === undefined) {
    await markLost(context, record, "reattach ports unavailable")
    return { task_id: record.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const respawned = await ports.respawn(record, sessionPath)
  if (!respawned.ok) {
    await markLost(context, record, `reattach failed: ${respawned.reason}`)
    return { task_id: record.task_id, kind: "lost", reason: respawned.reason }
  }
  const reattached = await ports.reattach(record, respawned.handle)
  if (!reattached.ok) {
    if (reattached.kind === "already_attached") {
      return { task_id: record.task_id, kind: "resumed", reason: reattached.reason }
    }
    await markLost(context, context.store.load(record.task_id) ?? record, reattached.reason)
    return { task_id: record.task_id, kind: "lost", reason: reattached.reason }
  }
  context.store.appendEvent(record.task_id, { type: "reconcile_reattached", payload: { session_path: sessionPath } })
  return { task_id: record.task_id, kind: "resumed", reason: "respawned and reattached" }
}

async function terminateClaimedPid(context: LifecycleContext, record: TaskRecord): Promise<boolean> {
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

function hasForeignLiveOwner(context: LifecycleContext, record: TaskRecord): boolean {
  return record.host_pid !== undefined && record.host_pid !== context.hostPid && context.signaller.isAlive(record.host_pid)
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

function newestSessionPath(context: LifecycleContext, taskId: string): string | undefined {
  const sessionDir = resolveChildSessionDir(join(context.store.stateDir, "children", taskId), taskId)
  try {
    let newest: { readonly path: string; readonly mtimeMs: number } | undefined
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const path = join(sessionDir, entry.name)
      const mtimeMs = statSync(path).mtimeMs
      if (newest === undefined || mtimeMs > newest.mtimeMs || (mtimeMs === newest.mtimeMs && path > newest.path)) {
        newest = { path, mtimeMs }
      }
    }
    return newest?.path
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

function heartbeatState(context: LifecycleContext, record: TaskRecord): "fresh" | "stale" {
  return context.now() - Date.parse(record.updated_at) < HEARTBEAT_FRESH_MS ? "fresh" : "stale"
}

async function markLost(context: LifecycleContext, record: TaskRecord, message: string): Promise<void> {
  const result = markRecordLostForReconciliation(record, {
    timestamp: nowIso(context),
    error_message: message,
    updateReason: record.status === "lost",
  })
  if (result.applied) {
    context.store.replace(result.record)
    context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
  }
  if (record.residency_state === "resident") await destroyResidentTask(context, record.task_id, "reconcile_lost")
}
