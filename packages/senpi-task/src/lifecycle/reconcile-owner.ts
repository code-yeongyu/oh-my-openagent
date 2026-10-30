import type { TaskRecord } from "../state"
import { reconciliationActive, type LifecycleContext } from "./context"
import { isHostSessionRecord } from "./host-session"

export async function hasForeignLiveOwner(
  context: LifecycleContext,
  record: TaskRecord,
  parentSessionId: string | undefined,
): Promise<boolean> {
  if (isHostSessionRecord(record)) {
    if (record.residency_state !== "resident") return false
    const alive = await context.hostSessionProbe.daemonAlive(record.host_session)
    if (!reconciliationActive(context)) return true
    const sessionLive = alive && await context.hostSessionProbe.sessionLive(record.host_session)
    if (!reconciliationActive(context)) return true
    if (!sessionLive) return false
    // The child's session outlives the process that owned its manager (the parent's own host).
    // When that owner is dead, the parent session reopening elsewhere is the only one left to
    // observe the child, so it must reclaim the record instead of deferring to a dead owner.
    return !(record.parent_session_id === parentSessionId && isDeadForeignOwner(context, record))
  }
  return record.host_pid !== undefined && record.host_pid !== context.hostPid && context.signaller.isAlive(record.host_pid)
}

function isDeadForeignOwner(context: LifecycleContext, record: TaskRecord): boolean {
  return record.host_pid !== undefined && record.host_pid !== context.hostPid && !context.signaller.isAlive(record.host_pid)
}
