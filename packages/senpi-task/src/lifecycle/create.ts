import { resolveContext } from "./context"
import { destroyResidentTask } from "./destroy"
import type { DestroyCause, LifecycleDeps } from "./port"
import { admitResident } from "./residency"
import { reconcileOnSessionStart } from "./reconcile"
import { teardownOnSessionShutdown } from "./shutdown"
import { cleanupExpiredRecords } from "./ttl"
import type { TaskLifecycle } from "./types"

/**
 * Bind the lifecycle operations to a store + residency registry + config. The returned object is the
 * only sanctioned way for the rest of the package (cancel, TTL, reconciliation, shutdown) to trigger
 * destruction - it owns the single-writer port.
 */
export function createTaskLifecycle(deps: LifecycleDeps): TaskLifecycle {
  const context = resolveContext(deps)
  return {
    destroyResidentTask: (taskId: string, cause: DestroyCause) => destroyResidentTask(context, taskId, cause),
    admitResident: (parentSessionId: string) => admitResident(context, parentSessionId),
    reconcileOnSessionStart: () => reconcileOnSessionStart(context),
    cleanupExpiredRecords: () => cleanupExpiredRecords(context),
    teardownOnSessionShutdown: () => teardownOnSessionShutdown(context),
  }
}
