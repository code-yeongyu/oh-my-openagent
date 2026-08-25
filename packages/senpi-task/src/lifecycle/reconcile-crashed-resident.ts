import { markRecordLostForReconciliation, type TaskRecord } from "../state"
import { nowIso, TERMINAL_STATUSES, type LifecycleContext } from "./context"

export async function markCrashedResident(
  context: LifecycleContext,
  record: TaskRecord,
  message: string,
): Promise<boolean> {
  let applied = false
  context.store.mutate(record.task_id, (fresh) => {
    if (fresh.host_pid !== context.hostPid || fresh.residency_state !== "resident") return fresh
    if (TERMINAL_STATUSES.has(fresh.status) && fresh.status !== "lost") {
      if (fresh.killed === true && fresh.error_message === message) return fresh
      applied = true
      return {
        ...fresh,
        killed: true,
        error_message: message,
        updated_at: nowIso(context),
      }
    }
    const result = markRecordLostForReconciliation(fresh, {
      timestamp: nowIso(context),
      error_message: message,
      updateReason: fresh.status === "lost",
    })
    if (!result.applied) return fresh
    applied = true
    return result.record
  })
  if (!applied) return false
  context.store.appendEvent(record.task_id, { type: "reconcile_lost", payload: { reason: message } })
  return true
}
