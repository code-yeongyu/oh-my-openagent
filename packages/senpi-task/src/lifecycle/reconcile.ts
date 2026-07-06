import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { ReconcileOutcome, ReconcileResult } from "./types"

const HEARTBEAT_FRESH_MS = 30_000

/**
 * On session_start, reconcile every persisted record against reality. Reattaching a running child is
 * impossible in v1, so a live rpc orphan is recorded `lost` with pid + session-dir breadcrumbs FIRST
 * and only THEN terminated through the destruction port (the no-orphan law). Dead/absent pids and
 * previous-process in-process children map to `lost` with no kill; completed terminals become a
 * `resumed` view.
 */
export async function reconcileOnSessionStart(context: LifecycleContext): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  for (const record of context.store.list().records) {
    outcomes.push(await reconcileRecord(context, record))
  }
  return { outcomes }
}

async function reconcileRecord(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (TERMINAL_STATUSES.has(record.status)) {
    return record.status === "lost"
      ? { task_id: record.task_id, kind: "lost", reason: "already lost" }
      : { task_id: record.task_id, kind: "resumed" }
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
  if (!context.signaller.isAlive(pid)) {
    markLost(context, record, `rpc pid=${pid} is dead; mapping exit facts only`)
    return { task_id: record.task_id, kind: "lost", reason: `dead pid ${pid}` }
  }

  const heartbeat = heartbeatState(context, record)
  markLost(context, record, `rpc orphan pid=${pid} session=${record.child_session_id ?? "unknown"} heartbeat=${heartbeat}; reattach unsupported in v1, terminating orphan`)
  await destroyResidentTask(context, record.task_id, "reconcile_lost")
  return { task_id: record.task_id, kind: "lost_and_terminated", reason: `live orphan, heartbeat=${heartbeat}` }
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
