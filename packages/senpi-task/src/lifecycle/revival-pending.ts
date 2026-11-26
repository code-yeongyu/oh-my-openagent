import type { TaskRecord } from "../state"
import type { LifecycleContext } from "./context"
import { isSuspensionExpiry } from "./suspended-expiry"

/**
 * Whether this host's lifecycle still owes a child a revival (#15150): the answer workflow recovery
 * asks for a non-terminal child it holds no handle for. It is live-parent recovery's own eligibility
 * read on the fresh record, bounded by the recovery deadline that recovery persisted and never renews,
 * so a pending answer always ends - in a revival, a terminal record, or the deadline.
 */
export type PendingRevivals = {
  pending(taskId: string): boolean
  // Settles after each live-parent recovery pass (store mutation, retry tick, finished attempt).
  changed(): Promise<undefined>
}

// All suspension causes (including old records with none) qualify. Terminal statuses, notably
// interrupted and completed idle evictions, do not represent unfinished runs. Accepted user cancels
// retain their existing confirmed-stop semantics.
export function awaitsLiveParentRecovery(context: LifecycleContext, record: TaskRecord): boolean {
  return (
    (record.status === "pending" || record.status === "running") &&
    (record.residency_state !== "resident" ||
      record.suspension_reason !== undefined ||
      (record.recovery_deadline_at !== undefined && context.registry.get(record.task_id) === undefined) ||
      isSuspensionExpiry(record)) &&
    record.cancel_requested === undefined &&
    (record.killed !== true || isSuspensionExpiry(record))
  )
}

export function createPendingRevivals(context: LifecycleContext): {
  readonly port: PendingRevivals
  readonly inspected: () => void
} {
  let pass = Promise.withResolvers<undefined>()
  return {
    port: {
      pending: (taskId) => {
        const record = context.store.load(taskId)
        return (
          record !== null &&
          context.registry.get(taskId) === undefined &&
          context.registry.ownsRecord?.(record) === true &&
          awaitsLiveParentRecovery(context, record) &&
          record.recovery_deadline_at !== undefined &&
          context.now() < record.recovery_deadline_at
        )
      },
      changed: () => pass.promise,
    },
    inspected: () => {
      const settled = pass
      pass = Promise.withResolvers<undefined>()
      settled.resolve(undefined)
    },
  }
}
