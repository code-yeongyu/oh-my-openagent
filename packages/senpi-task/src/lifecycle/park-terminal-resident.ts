import type { TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { isHostSessionRecord } from "./host-session"
import { pidLiveness } from "./pid-liveness"
import { suspendHandle } from "./shutdown"

/**
 * Releases a finished child that still holds a resident slot in THIS process (omo#9785): its process or
 * session is torn down through the bounded suspend path and the record parks (persisted_only /
 * rpc_detached), so it stays readable and revivable. Returns false, changing nothing, when there is no
 * such resident here: not a finished result (cancelled, lost and killed records belong to destruction), not
 * resident, owned elsewhere, mail pending, or already being torn down.
 */
export async function parkTerminalResident(context: LifecycleContext, taskId: string, reason: string): Promise<boolean> {
  if (context.registry.tryClaimEviction?.(taskId) === false) return false
  try {
    const fresh = context.store.load(taskId)
    if (
      fresh === null ||
      fresh.residency_state !== "resident" ||
      !TERMINAL_STATUSES.has(fresh.status) ||
      // A cancelled, lost or killed resident is an in-flight or finished destruction, not a parkable result.
      fresh.status === "cancelled" ||
      fresh.status === "lost" ||
      // An interrupted child is resumable, and a resume may hold its slot before its handle exists.
      fresh.status === "interrupted" ||
      fresh.killed === true ||
      context.registry.hasPendingSends(taskId)
    ) return false
    const handle = context.registry.get(taskId)
    if (handle !== undefined) {
      await suspendHandle(context, handle, reason)
      return true
    }
    return parkHandlelessResident(context, fresh, reason)
  } finally {
    context.registry.releaseEviction?.(taskId)
  }
}

/**
 * A finished child that never got (or already lost) its live handle in this process - a child whose
 * session the host refused to open, or one whose teardown already ran - still occupies a resident slot
 * until a session restart reconciles it (omo#9785 measured errored children resident for 17 h). When
 * nothing can still be running for it (this session's own record, no daemon session, no live child pid), only the
 * record is parked. A sibling session's child in the same process is never touched: it has this host_pid but not
 * this engine's ownership.
 */
export function parkHandlelessResident(context: LifecycleContext, record: TaskRecord, reason: string): boolean {
  if (record.host_pid !== context.hostPid || context.registry.ownsRecord?.(record) !== true) return false
  if (isHostSessionRecord(record) || context.failedTeardowns.has(record.task_id)) return false
  if (record.pid !== undefined && pidLiveness(record.pid) !== "dead") return false
  context.store.transition(record.task_id, {
    type: record.execution_mode === "in-process" ? "persist_only" : "detach_rpc",
    timestamp: nowIso(context),
  })
  context.store.appendEvent(record.task_id, { type: "suspended", payload: { reason } })
  return true
}
