import type { SuspensionReason } from "../state"
import { nowIso, type LifecycleContext } from "./context"

/**
 * The three record writes the daemon path owns. They are shared by reconciliation and by the
 * daemon-loss parking path, and they live apart from both so neither has to import the other.
 */

/** Park the record at rpc_detached, dropping this process's claim. The status is deliberately kept. */
export function parkHostSessionRecord(context: LifecycleContext, taskId: string): void {
  context.store.mutate(taskId, (fresh) => {
    if (fresh.residency_state === "rpc_detached" && fresh.host_pid === undefined) return fresh
    const { host_pid: _hostPid, ...rest } = fresh
    return { ...rest, residency_state: "rpc_detached", updated_at: nowIso(context) }
  })
}

/** Durable "why this child is still parked", read back by task_output. */
export function markSuspensionReason(context: LifecycleContext, taskId: string, reason: SuspensionReason): void {
  context.store.mutate(taskId, (fresh) =>
    fresh.suspension_reason === reason ? fresh : { ...fresh, suspension_reason: reason },
  )
}

/** A revival that landed clears the marker: the child is reachable again. */
export function clearSuspensionReason(context: LifecycleContext, taskId: string): void {
  context.store.mutate(taskId, (fresh) => {
    if (fresh.suspension_reason === undefined) return fresh
    const { suspension_reason: _reason, ...rest } = fresh
    return rest
  })
}
