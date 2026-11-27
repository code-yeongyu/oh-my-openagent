import type { TaskRecord } from "../state"
import type { LifecycleContext } from "./context"
import { retriesStopped } from "./deferred-revival"
import { expiryInFlight, isSuspensionExpiry } from "./suspended-expiry"

/**
 * Whether this host's lifecycle still has an open revival obligation for a child (#15150), the answer
 * workflow recovery asks for a non-terminal child it holds no handle for. Live-parent recovery owns the
 * only end condition: a child is `owed` while it still has to revive or end it (an attempt or expiry in
 * flight, or the child still eligible - including the one final attempt past the recovery deadline),
 * `none` once it has no obligation (not owned here, not eligible, or claimed for expiry whose close
 * attempt is over), and `stopped` once the lifecycle is disposed or the session's retries stopped.
 */
export type RevivalObligation = "owed" | "none" | "stopped"

export type PendingRevivals = {
  obligation(taskId: string): RevivalObligation
  // Settles after each live-parent pass (store mutation, retry tick, finished attempt), on dispose and
  // when the session's retries stop.
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

/**
 * The obligation answer from live-parent recovery's own episode state, read on the fresh record.
 * Ownership comes first: a session-scoped fact (stopped retries, an episode, an expiry in flight) is
 * only asked of a child this engine's current session owns.
 *
 * | lifecycle disposed | record | owned here | session retries stopped | open obligation              | answer  |
 * |--------------------|--------|------------|-------------------------|------------------------------|---------|
 * | yes                | any    | any        | any                     | any                          | stopped |
 * | no                 | none   | -          | -                       | -                            | none    |
 * | no                 | yes    | no         | any                     | any                          | none    |
 * | no                 | yes    | yes        | yes                     | any                          | stopped |
 * | no                 | yes    | yes        | no                      | attempt or expiry in flight  | owed    |
 * | no                 | yes    | yes        | no                      | eligible, not claimed expiry | owed    |
 * | no                 | yes    | yes        | no                      | none of the above            | none    |
 */
export function revivalObligation(
  context: LifecycleContext,
  taskId: string,
  recovery: {
    readonly disposed: boolean
    readonly episode: { readonly busy: boolean; readonly expiring: boolean } | undefined
    readonly eligible: (record: TaskRecord) => boolean
    readonly scan: () => void
  },
): RevivalObligation {
  if (recovery.disposed) return "stopped"
  const record = context.store.load(taskId)
  if (record === null || context.registry.ownsRecord?.(record) !== true) return "none"
  if (retriesStopped(context, record.parent_session_id)) return "stopped"
  if (recovery.episode?.busy === true || recovery.episode?.expiring === true || expiryInFlight(context, taskId))
    return "owed"
  // A claim for expiry whose close attempt is over ends the revival obligation, confirmed or not.
  if (!recovery.eligible(record) || isSuspensionExpiry(record)) return "none"
  // Eligible before its first inspection: the episode opens at the scan this schedules.
  if (recovery.episode === undefined) recovery.scan()
  return "owed"
}

export function createRevivalPasses(): { readonly changed: () => Promise<undefined>; readonly passed: () => void } {
  let pass = Promise.withResolvers<undefined>()
  return {
    changed: () => pass.promise,
    passed: () => {
      const settled = pass
      pass = Promise.withResolvers<undefined>()
      settled.resolve(undefined)
    },
  }
}
