import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaimAge } from "./owned-attempt"
import { isLiveTask } from "./scheduler-context"
import type { DagNode, DagNodeErrorCode } from "./types"

export type RecoveredNodeTask =
  | { readonly kind: "task"; readonly task: TaskRecord }
  | { readonly kind: "start" }
  | { readonly kind: "missing" }
  | { readonly kind: "fail"; readonly code: DagNodeErrorCode; readonly message: string }

/**
 * Resolves the task of the node's CURRENT execAttempt before recovery attaches, folds, or starts
 * anything (#11381). A retry retains the prior taskId and admission journals `scheduled` before it
 * starts the replacement, so a crash in that window leaves only the previous attempt's task: it is
 * never folded or re-attached. A live one is stopped first, and the node fails closed with the
 * retryable `stale_attempt_alive` when it cannot be stopped; otherwise the node starts afresh.
 */
export function resolveRecoveredNodeTask(
  taskManager: TaskManager,
  record: DagRunRecordV1,
  node: DagNode,
): RecoveredNodeTask | Promise<RecoveredNodeTask> {
  const owned = taskManager.findOwnedTasks({ kind: "dag", runId: record.runId, nodeId: node.id })
  const retained = node.taskId === undefined ? undefined : taskManager.get(node.taskId)
  const claims =
    retained === undefined || owned.some((task) => task.task_id === retained.task_id) ? owned : [...owned, retained]
  const current = claims.findLast((task) => ownedClaimAge(task, record) === "current")
  if (current !== undefined) return { kind: "task", task: current }
  const stale = claims.filter((task) => ownedClaimAge(task, record) === "superseded")
  const live = stale.filter(isLiveTask)
  // Synchronous unless a stale child must be stopped: reconcile hands live children to the scheduler
  // without yielding, so a settle racing the restart is never folded twice.
  if (live.length === 0) return afterStops(taskManager, node, stale)
  return Promise.all(
    live.map((task) =>
      taskManager.cancelTask(task.task_id, `superseded by attempt ${node.execAttempt ?? 0} of DAG node "${node.id}"`),
    ),
  ).then(
    () => afterStops(taskManager, node, stale),
    () => afterStops(taskManager, node, stale),
  )
}

function afterStops(taskManager: TaskManager, node: DagNode, stale: readonly TaskRecord[]): RecoveredNodeTask {
  const alive = stale.filter((task) => isLiveTask(taskManager.get(task.task_id)))
  if (alive.length > 0) {
    const ids = alive.map((task) => task.task_id).join(", ")
    return {
      kind: "fail",
      code: "stale_attempt_alive",
      message: `task ${ids} of a superseded attempt could not be stopped`,
    }
  }
  if (node.state === "scheduled" && (node.taskId === undefined || stale.length > 0)) return { kind: "start" }
  if (stale.length > 0) {
    return {
      kind: "fail",
      code: "resume_task_missing",
      message: `no task of attempt ${node.execAttempt ?? 0} exists; only superseded task ${stale.at(-1)?.task_id}`,
    }
  }
  return { kind: "missing" }
}
