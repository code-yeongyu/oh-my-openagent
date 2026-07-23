import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { getLifecycleReattachPorts } from "./port"
import type { ReconcileOutcome, ReconcileResult } from "./types"

const HEARTBEAT_FRESH_MS = 30_000

/** Reconcile persisted task records with handles and processes visible to this session. */
export async function reconcileOnSessionStart(context: LifecycleContext): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  for (const record of context.store.list().records) {
    outcomes.push(await reconcileRecord(context, record))
  }
  return { outcomes }
}

async function reconcileRecord(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (hasLiveResidentHandle(context, record.task_id)) {
    return { task_id: record.task_id, kind: "resumed", reason: "owned by this process" }
  }

  if (TERMINAL_STATUSES.has(record.status)) {
    return reconcileTerminalRecord(context, record)
  }

  if (record.execution_mode !== "process") {
    // The project store is shared by every senpi process in this project. A record owned by a LIVE
    // sibling process is not orphaned: marking it lost here would clobber that process's running
    // child (its completion would then be dropped as a late transition). Only a dead owner - or a
    // legacy record with no owner pid - is genuinely unreachable from any process.
    const ownerPid = record.host_pid
    if (ownerPid !== undefined && ownerPid !== context.hostPid && context.signaller.isAlive(ownerPid)) {
      return {
        task_id: record.task_id,
        kind: "foreign_live_owner",
        reason: `in-process child owned by live process pid=${ownerPid}`,
      }
    }
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
    return reconcileWithoutReattach(context, record, pid, alive)
  }

  const sessionPath = newestSessionPath(context, record.task_id)
  if (!alive) {
    if (sessionPath !== undefined) return reattachRecord(context, record, sessionPath)
    await markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }

  const heartbeat = heartbeatState(context, record)
  await markLost(
    context,
    record,
    `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; terminating before reattach`,
  )
  if (sessionPath === undefined) {
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  const current = context.store.load(record.task_id) ?? record
  return reattachRecord(context, current, sessionPath)
}

async function reconcileWithoutReattach(
  context: LifecycleContext,
  record: TaskRecord,
  pid: number,
  alive: boolean,
): Promise<ReconcileOutcome> {
  if (!alive) {
    await markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }
  return loseAndTerminate(context, record, pid)
}

async function loseAndTerminate(
  context: LifecycleContext,
  record: TaskRecord,
  pid: number,
): Promise<ReconcileOutcome> {
  const heartbeat = heartbeatState(context, record)
  await markLost(
    context,
    record,
    `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; reattach disabled, terminating orphan`,
  )
  return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
}

async function reattachRecord(
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
  context.store.appendEvent(record.task_id, {
    type: "reconcile_reattached",
    payload: { session_path: sessionPath },
  })
  return { task_id: record.task_id, kind: "resumed", reason: "respawned and reattached" }
}

async function reconcileTerminalRecord(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (record.status === "lost") {
    // Self-heal leaked {lost, resident} records persisted before lost tasks released their claim: a
    // lost child is unreachable, so it must never keep holding a residency slot across sessions.
    if (record.residency_state === "resident") await destroyResidentTask(context, record.task_id, "reconcile_lost")
    return { task_id: record.task_id, kind: "lost", reason: "already lost" }
  }
  const pid = record.pid
  if (record.execution_mode !== "process" || record.residency_state !== "resident" || pid === undefined) {
    return { task_id: record.task_id, kind: "resumed" }
  }

  const alive = context.signaller.isAlive(pid)
  const sessionPath = newestSessionPath(context, record.task_id)
  if (alive) {
    await destroyResidentTask(context, record.task_id, "reconcile_lost")
    if (sessionPath === undefined || context.config.reattach_on_reconcile === false) {
      return { task_id: record.task_id, kind: "lost_and_terminated", reason: `terminal resident orphan pid ${pid}` }
    }
    return reattachRecord(context, context.store.load(record.task_id) ?? record, sessionPath)
  }
  if (sessionPath !== undefined && context.config.reattach_on_reconcile !== false) {
    return reattachRecord(context, record, sessionPath)
  }
  return { task_id: record.task_id, kind: "resumed" }
}

function hasLiveResidentHandle(context: LifecycleContext, taskId: string): boolean {
  // The adapter registry is a view over the manager and can briefly expose an incomplete keyed
  // lookup while a session transition is publishing its new epoch. The entries snapshot is the
  // authoritative same-process ownership witness; never classify that resident as a prior-process
  // task merely because the point lookup missed it.
  return context.registry.get(taskId) !== undefined || context.registry.entries().some((handle) => handle.task_id === taskId)
}

function newestSessionPath(context: LifecycleContext, taskId: string): string | undefined {
  const sessionDir = resolveChildSessionDir(join(context.store.stateDir, "children", taskId), taskId)
  try {
    let newest: { readonly path: string; readonly mtimeMs: number } | undefined
    for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const path = join(sessionDir, entry.name)
      const mtimeMs = statSync(path).mtimeMs
      if (
        newest === undefined ||
        mtimeMs > newest.mtimeMs ||
        (mtimeMs === newest.mtimeMs && path > newest.path)
      ) {
        newest = { path, mtimeMs }
      }
    }
    return newest?.path
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function heartbeatState(context: LifecycleContext, record: TaskRecord): "fresh" | "stale" {
  return context.now() - Date.parse(record.updated_at) < HEARTBEAT_FRESH_MS ? "fresh" : "stale"
}

// Mark a record lost AND release its residency claim through the destruction port: a lost child is
// unreachable, so it must never keep occupying a residency slot the LRU gate cannot reclaim
// (the reconcile_lost cause also kills a still-alive orphan pid before the claim is dropped).
async function markLost(context: LifecycleContext, record: TaskRecord, message: string): Promise<void> {
  const result = markRecordLostForReconciliation(record, { timestamp: nowIso(context), error_message: message })
  if (!result.applied) return
  context.store.replace(result.record)
  context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
}
