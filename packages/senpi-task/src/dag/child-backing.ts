import type { PendingRevivals } from "../lifecycle/revival-pending"
import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"

export type ChildBacking =
  | { readonly kind: "live" }
  | { readonly kind: "revival_pending" }
  | { readonly kind: "orphaned"; readonly reason: string }

// What backs a non-terminal child of a node this host is recovering. A re-adopted node folds only when
// `TaskManager.waitFor` settles, and that resolves from this process's own waiter map (or an already-
// terminal stored record) - never from a child some other process holds. So `status` alone cannot
// decide re-adoption: a daemon-hosted child parked at `rpc_detached` keeps `running` by design, and a
// record frozen `resident` under a foreign pid is left untouched by lifecycle reconcile. Re-adopting
// either one would pin its node at `running` in every future checkpoint. So:
// - live: this host holds the child (the resident-handle map that feeds those waiters; never a pid
//   probe - a pid can be alive while the session it hosted is gone);
// - revival_pending: this host's lifecycle still owes the child a revival or an end by its persisted
//   recovery deadline (a capacity deferral, an unreachable task host) - session-start reconcile ran
//   first but could not revive it yet, so the node waits for that answer (#15150);
// - orphaned: no host will ever settle it here.
export function childBacking(
  context: { readonly taskManager: TaskManager; readonly pendingRevivals?: PendingRevivals },
  task: TaskRecord,
): ChildBacking {
  if (context.taskManager.getResidentHandle(task.task_id) !== undefined) return { kind: "live" }
  if (context.pendingRevivals?.pending(task.task_id) === true) return { kind: "revival_pending" }
  return { kind: "orphaned", reason: orphanedTaskReason(task) }
}

export function orphanedTaskReason(task: TaskRecord): string {
  const residency = [
    `residency_state=${task.residency_state}`,
    ...(task.suspension_reason === undefined ? [] : [`suspension_reason=${task.suspension_reason}`]),
    ...(task.runner_kind === undefined ? [] : [`runner_kind=${task.runner_kind}`]),
    ...(task.host_pid === undefined ? [] : [`host_pid=${task.host_pid}`]),
  ].join(", ")
  return (
    `task ${task.task_id} still reads ${task.status} but no child of this host backs it ` +
    `(${residency}); its settlement can never be observed here. Retry or send revives the node.`
  )
}
