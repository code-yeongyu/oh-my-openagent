import { resolveContext } from "./context"
import { disposeScopedRetries, resumeScopedRetries, stopScopedRetries } from "./deferred-revival"
import { reconcileDeferredDeadChildren, retryDeferredLegacyOwners } from "./deferred-owner-reconcile"
import { destroyResidentTask } from "./destroy"
import { driveHostSessionCancel } from "./host-session-cancel-driver"
import { endHostSessionChild } from "./host-session-end"
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
  let disposed = false
  const generations = new Map<string | undefined, number>()
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
    hostSessionCancel: {
      end: (record) => endHostSessionChild(context, record),
      drive: (record, sink) => driveHostSessionCancel(context, record, sink),
    },
    // Parent shutdown: the kernel that owns every granted closure dies with this engine, so the
    // whole runtime binding map goes too - no strong reference to a disposed kernel survives.
    dispose: () => {
      disposed = true
      stopIdleReclaimer()
      recovery.dispose()
      disposeScopedRetries(context)
      context.kernelToolBindings?.releaseAll()
    },
    admitResident: (parentSessionId: string) => admitResident(context, parentSessionId),
    reconcileOnSessionStart: async (parentSessionId?: string, signal?: AbortSignal) => {
      if (disposed || signal?.aborted) return { outcomes: [] }
      const generation = generations.get(parentSessionId) ?? 0
      generations.set(parentSessionId, generation)
      const active = () => !disposed && !signal?.aborted && generations.get(parentSessionId) === generation
      const pass = { ...context, reconcileActive: active }
      if (parentSessionId !== undefined) resumeScopedRetries(context, parentSessionId)
      retrySuspendedClosures(context, parentSessionId)
      const result = await recovery.reconcile(async () => {
        const initial = await reconcileOnSessionStart(pass, parentSessionId)
        if (!active()) return { outcomes: [] }
        return { outcomes: await reconcileDeferredDeadChildren(pass, initial.outcomes, parentSessionId) }
      })
      if (!active()) return { outcomes: [] }
      retryDeferredHostSessions(context, result.outcomes, parentSessionId)
      retryDeferredLegacyOwners(context, result.outcomes, parentSessionId)
      recovery.scan()
      return result
    },
    parkHostSessionOnDaemonLoss: (taskId: string, options?: HostSessionParkOptions) =>
      parkHostSessionOnDaemonLoss(context, taskId, options),
    cleanupExpiredRecords: cleanup,
    suspendOnSessionShutdown: (input: SuspendInput) => {
      generations.set(input.parentSessionId, (generations.get(input.parentSessionId) ?? 0) + 1)
      generations.set(undefined, (generations.get(undefined) ?? 0) + 1)
      stopScopedRetries(context, input.parentSessionId)
      return suspendOnSessionShutdown(context, input)
    },
  }
}
