import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

import { isProcessPid } from "../state/pid"
import { resolveChildSessionDir } from "../runners/rpc/spawn"
import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { getLifecycleReattachPorts } from "./port"
import type { ReconcileOutcome, ReconcileResult } from "./types"

export async function reconcileOnSessionStart(context: LifecycleContext, currentSessionId: string | undefined): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  for (const record of context.store.list().records) {
    outcomes.push(await reconcileRecord(context, record, currentSessionId))
  }
  return { outcomes }
}

async function reconcileRecord(
  context: LifecycleContext,
  record: TaskRecord,
  currentSessionId: string | undefined,
): Promise<ReconcileOutcome> {
  if (currentSessionId === undefined || currentSessionId.length === 0) {
    return { task_id: record.task_id, kind: "untrusted_session", reason: "current session unavailable" }
  }
  if (record.parent_session_id !== currentSessionId) {
    return { task_id: record.task_id, kind: "foreign_session", reason: "record belongs to another session" }
  }
  if (hasLiveResidentHandle(context, record.task_id)) {
    return { task_id: record.task_id, kind: "resumed", reason: "owned by this process" }
  }

  const foreignHostPid = record.host_pid
  if (foreignHostPid !== undefined && isProcessPid(foreignHostPid) && foreignHostPid !== context.hostPid) {
    if (context.signaller.isAlive(foreignHostPid)) {
      return { task_id: record.task_id, kind: "foreign_live_owner", reason: `task owned by live process pid=${foreignHostPid}` }
    }
  }

  if (TERMINAL_STATUSES.has(record.status)) {
    return reconcileTerminalRecord(context, record, currentSessionId)
  }

  if (record.execution_mode !== "process") {
    await markLost(context, record, "in-process task from a previous process cannot be reattached")
    return { task_id: record.task_id, kind: "lost", reason: "previous-process in-process" }
  }

  const pid = record.pid
  if (pid === undefined || !isProcessPid(pid)) {
    await markLost(context, record, "rpc task had no recorded pid")
    return { task_id: record.task_id, kind: "lost", reason: "no recorded pid" }
  }

  const alive = context.signaller.isAlive(pid)
  if (alive) {
    return { task_id: record.task_id, kind: "untrusted_live_process", reason: `live pid ${pid} has no local handle` }
  }

  const sessionPath = newestSessionPath(context, record.task_id)
  if (context.config.reattach_on_reconcile === false || sessionPath === undefined) {
    await markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }
  return reattachRecord(context, record, currentSessionId, sessionPath)
}

async function reattachRecord(
  context: LifecycleContext,
  record: TaskRecord,
  currentSessionId: string,
  sessionPath: string,
): Promise<ReconcileOutcome> {
  const ports = context.reattachPorts ?? getLifecycleReattachPorts(context.store)
  if (ports === undefined) {
    await markLost(context, record, "reattach ports unavailable")
    return { task_id: record.task_id, kind: "lost", reason: "reattach ports unavailable" }
  }

  const respawned = await ports.respawn(record, currentSessionId, sessionPath)
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

async function reconcileTerminalRecord(
  context: LifecycleContext,
  record: TaskRecord,
  currentSessionId: string,
): Promise<ReconcileOutcome> {
  const pid = record.pid
  if (record.execution_mode !== "process" || record.residency_state !== "resident" || pid === undefined || !isProcessPid(pid)) {
    if (record.status === "lost") {
      if (record.residency_state === "resident") await destroyResidentTask(context, record.task_id, "reconcile_lost")
      return { task_id: record.task_id, kind: "lost", reason: "already lost" }
    }
    return { task_id: record.task_id, kind: "resumed" }
  }

  const alive = context.signaller.isAlive(pid)
  const sessionPath = newestSessionPath(context, record.task_id)
  if (alive) {
    return { task_id: record.task_id, kind: "untrusted_live_process", reason: `live pid ${pid} has no local handle` }
  }
  if (record.status === "lost") {
    await destroyResidentTask(context, record.task_id, "reconcile_lost")
    return { task_id: record.task_id, kind: "lost", reason: "already lost" }
  }
  if (sessionPath !== undefined && context.config.reattach_on_reconcile !== false) {
    return reattachRecord(context, record, currentSessionId, sessionPath)
  }
  return { task_id: record.task_id, kind: "resumed" }
}

function hasLiveResidentHandle(context: LifecycleContext, taskId: string): boolean {
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
      if (newest === undefined || mtimeMs > newest.mtimeMs || (mtimeMs === newest.mtimeMs && path > newest.path)) {
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

async function markLost(context: LifecycleContext, record: TaskRecord, message: string): Promise<void> {
  const result = markRecordLostForReconciliation(record, { timestamp: nowIso(context), error_message: message })
  if (!result.applied) return
  context.store.replace(result.record)
  context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
}
