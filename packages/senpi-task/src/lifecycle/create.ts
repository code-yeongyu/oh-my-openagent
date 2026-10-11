import { resolveContext } from "./context"
import { disposeScopedRetries, resumeScopedRetries, stopScopedRetries } from "./deferred-revival"
import { reconcileDeferredDeadChildren, retryDeferredLegacyOwners } from "./deferred-owner-reconcile"
import { destroyResidentTask } from "./destroy"
import { parkHostSessionOnDaemonLoss, retryDeferredHostSessions, type HostSessionParkOptions } from "./host-session-revive"
import { registerLifecycleDetachedRevival, registerLifecycleDetachedRevivalRollback, type DestroyCause, type LifecycleDeps } from "./port"
import { parkTerminalResident } from "./park-terminal-resident"
import { admitResident, reclaimIdleResidents, startIdleResidentReclaimer } from "./residency"
import { reconcileOnSessionStart } from "./reconcile"
import { rollbackDetachedRevival, reviveDetachedTerminal } from "./revive-detached"
import { suspendOnSessionShutdown } from "./shutdown"
import { cleanupExpiredRecords } from "./ttl"
import type { SuspendInput, TaskLifecycle } from "./types"
import { startLiveParentRecovery } from "./live-parent-recovery"
import { retrySuspendedClosures } from "./suspended-closures"

/**
 * Bind the lifecycle operations to a store + residency registry + config. The returned object is the
 * only sanctioned way for the rest of the package (cancel, TTL, reconciliation, shutdown) to trigger
 * destruction - it owns the single-writer port.
 */
export function createTaskLifecycle(deps: LifecycleDeps): TaskLifecycle {
  const context = resolveContext(deps)
  const cleanup = async () => {
    retrySuspendedClosures(context)
    return cleanupExpiredRecords(context)
  }
  const recovery = startLiveParentRecovery(context, deps.onStoreMutation)
  registerLifecycleDetachedRevival(context.store, (taskId) => reviveDetachedTerminal(context, taskId))
  registerLifecycleDetachedRevivalRollback(context.store, (prior) => rollbackDetachedRevival(context, prior))
  const stopIdleReclaimer = startIdleResidentReclaimer(context, cleanup)
  return {
    destroyResidentTask: (taskId: string, cause: DestroyCause) => destroyResidentTask(context, taskId, cause),
    rollbackDetachedRevival: (prior) => rollbackDetachedRevival(context, prior),
    reclaimIdleResidents: () => reclaimIdleResidents(context),
    parkTerminalResident: (taskId: string) => parkTerminalResident(context, taskId, "cancel"),
    // Parent shutdown: the kernel that owns every granted closure dies with this engine, so the
    // whole runtime binding map goes too - no strong reference to a disposed kernel survives.
    dispose: () => {
      stopIdleReclaimer()
      recovery.dispose()
      disposeScopedRetries(context)
      context.kernelToolBindings?.releaseAll()
    },
    admitResident: (parentSessionId: string) => admitResident(context, parentSessionId),
    reconcileOnSessionStart: async (parentSessionId?: string) => {
      if (parentSessionId !== undefined) resumeScopedRetries(context, parentSessionId)
      retrySuspendedClosures(context, parentSessionId)
      const result = await recovery.reconcile(async () => {
        const initial = await reconcileOnSessionStart(context, parentSessionId)
        return { outcomes: await reconcileDeferredDeadChildren(context, initial.outcomes, parentSessionId) }
      })
      retryDeferredHostSessions(context, result.outcomes, parentSessionId)
      retryDeferredLegacyOwners(context, result.outcomes, parentSessionId)
      recovery.scan()
      return result
    },
    parkHostSessionOnDaemonLoss: (taskId: string, options?: HostSessionParkOptions) =>
      parkHostSessionOnDaemonLoss(context, taskId, options),
    cleanupExpiredRecords: cleanup,
    suspendOnSessionShutdown: (input: SuspendInput) => {
      stopScopedRetries(context, input.parentSessionId)
      return suspendOnSessionShutdown(context, input)
    },
  }
}
