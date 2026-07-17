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
  if (context.registry.get(record.task_id) !== undefined) {
    return { task_id: record.task_id, kind: "resumed", reason: "owned by this process" }
  }

  if (TERMINAL_STATUSES.has(record.status)) {
    return reconcileTerminalRecord(context, record)
  }

  if (record.execution_mode !== "process") {
    markLost(context, record, "in-process task from a previous process cannot be reattached")
    return { task_id: record.task_id, kind: "lost", reason: "previous-process in-process" }
  }

  const pid = record.pid
  if (pid === undefined) {
    markLost(context, record, "rpc task had no recorded pid")
    return { task_id: record.task_id, kind: "lost", reason: "no recorded pid" }
  }

  const alive = context.signaller.isAlive(pid)
  if (context.config.reattach_on_reconcile === false) {
    return reconcileWithoutReattach(context, record, pid, alive)
  }

  const sessionPath = newestSessionPath(context, record.task_id)
  if (!alive) {
    if (sessionPath !== undefined) return reattachRecord(context, record, sessionPath)
    markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }

  const heartbeat = heartbeatState(context, record)
  markLost(
    context,
    record,
    `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; terminating before reattach`,
  )
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
  if (sessionPath === undefined) {
    return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
  }
  const current = context.store.load(record.task_id) ?? record
  return reattachRecord(context, current, sessionPath)
}

function reconcileWithoutReattach(
  context: LifecycleContext,
  record: TaskRecord,
  pid: number,
  alive: boolean,
): Promise<ReconcileOutcome> | ReconcileOutcome {
  if (!alive) {
    markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
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
  markLost(
    context,
    record,
    `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; reattach disabled, terminating orphan`,
  )
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
  return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
}

async function reattachRecord(
  context: LifecycleContext,
  record: TaskRecord,
  sessionPath: string,
): Promise<ReconcileOutcome> {
  const ports = context.reattachPorts ?? getLifecycleReattachPorts(context.store)
  if (ports === undefined) {
    markLost(context, record, "reattach ports unavailable")
    return { task_id: record.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const respawned = await ports.respawn(record, sessionPath)
  if (!respawned.ok) {
    markLost(context, record, `reattach failed: ${respawned.reason}`)
    return { task_id: record.task_id, kind: "lost", reason: respawned.reason }
  }
  const reattached = await ports.reattach(record, respawned.handle)
  if (!reattached.ok) {
    if (reattached.kind === "already_attached") {
      return { task_id: record.task_id, kind: "resumed", reason: reattached.reason }
    }
    markLost(context, context.store.load(record.task_id) ?? record, reattached.reason)
    return { task_id: record.task_id, kind: "lost", reason: reattached.reason }
  }
  context.store.appendEvent(record.task_id, {
    type: "reconcile_reattached",
    payload: { session_path: sessionPath },
  })
  return { task_id: record.task_id, kind: "resumed", reason: "respawned and reattached" }
}

async function reconcileTerminalRecord(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (record.status === "lost") return { task_id: record.task_id, kind: "lost", reason: "already lost" }
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

function markLost(context: LifecycleContext, record: TaskRecord, message: string): void {
  const result = markRecordLostForReconciliation(record, { timestamp: nowIso(context), error_message: message })
  if (!result.applied) return
  context.store.replace(result.record)
  context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
}
