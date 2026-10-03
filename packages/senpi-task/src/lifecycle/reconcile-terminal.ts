import { transitionTaskRecord, type TaskRecord } from "../state"
import { delay, nowIso, type LifecycleContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { newestSessionPath } from "./session-path"
import type { ReconcileOutcome } from "./types"

export async function reconcileLegacyTerminal(context: LifecycleContext, record: TaskRecord): Promise<ReconcileOutcome> {
  if (record.status === "lost" || record.status === "cancelled") {
    if (record.residency_state === "resident") await destroyResidentTask(context, record.task_id, "reconcile_lost")
    return { task_id: record.task_id, kind: record.status === "lost" ? "lost" : "resumed", reason: `already ${record.status}` }
  }
  if (record.residency_state !== "resident") return { task_id: record.task_id, kind: "resumed" }
  if (newestSessionPath(context, record.task_id) === undefined) {
    await destroyResidentTask(context, record.task_id, "reconcile_lost")
    return {
      task_id: record.task_id,
      kind: "resumed",
      reason: "terminal without transcript disposed; persisted result preserved",
    }
  }
  return detachTerminalResident(context, record)
}

/** Release a terminal resident without relaunching its completed child session. */
export async function detachTerminalResident(
  context: LifecycleContext,
  record: TaskRecord,
): Promise<ReconcileOutcome> {
  if (record.execution_mode === "process" && record.pid !== undefined) {
    const terminated = await terminateClaimedPid(context, record)
    if (!terminated) {
      return {
        task_id: record.task_id,
        kind: "deferred",
        reason: "terminal resident pid could not be terminated",
      }
    }
  }

  let applied = false
  context.store.mutate(record.task_id, (fresh) => {
    if (
      fresh.residency_state !== "resident" ||
      fresh.host_pid !== context.hostPid ||
      fresh.updated_at !== record.updated_at ||
      hasLiveHandle(context, record.task_id)
    ) return fresh
    const transition = transitionTaskRecord(fresh, {
      type: fresh.execution_mode === "process" ? "detach_rpc" : "persist_only",
      timestamp: nowIso(context),
    })
    if (!transition.applied) return fresh
    applied = true
    return transition.record
  })
  if (!applied) return { task_id: record.task_id, kind: "deferred", reason: "foreign_live_owner" }
  return { task_id: record.task_id, kind: "resumed", reason: "terminal resident detached" }
}

function hasLiveHandle(context: LifecycleContext, taskId: string): boolean {
  return context.registry.get(taskId) !== undefined || context.registry.entries().some((handle) => handle.task_id === taskId)
}

export async function terminateClaimedPid(context: LifecycleContext, record: TaskRecord): Promise<boolean> {
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
