import { resolveContext } from "./context"
import { destroyResidentTask } from "./destroy"
import { registerLifecycleDetachedRevival, registerLifecycleDetachedRevivalRollback, type DestroyCause, type LifecycleDeps } from "./port"
import { admitResident, reclaimIdleResidents, startIdleResidentReclaimer } from "./residency"
import { reconcileOnSessionStart } from "./reconcile"
import { rollbackDetachedRevival, reviveDetachedTerminal } from "./revive-detached"
import { suspendOnSessionShutdown } from "./shutdown"
import { cleanupExpiredRecords } from "./ttl"
import type { SuspendInput, TaskLifecycle } from "./types"

/**
 * Bind the lifecycle operations to a store + residency registry + config. The returned object is the
 * only sanctioned way for the rest of the package (cancel, TTL, reconciliation, shutdown) to trigger
 * destruction - it owns the single-writer port.
 */
export function createTaskLifecycle(deps: LifecycleDeps): TaskLifecycle {
  const context = resolveContext(deps)
  const cleanup = () => cleanupExpiredRecords(context)
  registerLifecycleDetachedRevival(context.store, (taskId) => reviveDetachedTerminal(context, taskId))
  registerLifecycleDetachedRevivalRollback(context.store, (prior) => rollbackDetachedRevival(context, prior))
  const stopIdleReclaimer = startIdleResidentReclaimer(context, cleanup)
  return {
    destroyResidentTask: (taskId: string, cause: DestroyCause) => destroyResidentTask(context, taskId, cause),
    rollbackDetachedRevival: (prior) => rollbackDetachedRevival(context, prior),
    reclaimIdleResidents: () => reclaimIdleResidents(context),
    dispose: stopIdleReclaimer,
    admitResident: (parentSessionId: string) => admitResident(context, parentSessionId),
    reconcileOnSessionStart: (parentSessionId?: string) => reconcileOnSessionStart(context, parentSessionId),
    cleanupExpiredRecords: cleanup,
    suspendOnSessionShutdown: (input: SuspendInput) => suspendOnSessionShutdown(context, input),
  }
}
