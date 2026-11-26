import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import { dagNodeReusedEvent, dagNodeTransitionedEvent } from "./events"
import type { DagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import { readDagNodeResult } from "./results"
import type { DagFileStore } from "./store"
import type { DagNode, DagNodeId, DagRunId } from "./types"

export type CompletedNodeRecovery = {
  readonly store: DagFileStore
  readonly taskManager: TaskManager
  readonly journal: DagJournal<DagRunRecordV1>
  readonly reusedOutputs: Map<DagNodeId, string>
  readonly reattachedTasks: Map<DagNodeId, string>
}

// A completed node is reused from its durable output, unless its child resumed on its own while no
// scheduler held this active run and that resumed run ended without the node folding it (#12134).
// Then the node re-opens and its task is handed to the scheduler, whose settle loop folds the ended
// run like any other: a failure fails the node and skips its pending dependents.
export function reconcileCompletedNode(recovery: CompletedNodeRecovery, node: DagNode): void {
  const runId = recovery.journal.snapshot().runId
  const result = readDagNodeResult({ store: recovery.store, runId, nodeId: node.id })
  const task = node.taskId === undefined ? undefined : recovery.taskManager.get(node.taskId)
  if (task !== undefined && endedUnfoldedResumedRun(task, runId, node.id, result?.output)) {
    recovery.journal.append(
      dagNodeTransitionedEvent({ nodeId: node.id, from: "completed", to: "running", reason: { kind: "resumed" } }),
    )
    recovery.reattachedTasks.set(node.id, task.task_id)
    return
  }
  if (result === null) return
  recovery.reusedOutputs.set(node.id, result.output)
  if (node.taskId !== undefined) {
    recovery.journal.append(dagNodeReusedEvent({ nodeId: node.id, taskId: node.taskId, sourceRunId: runId }))
  }
}

// Durable evidence that a completed node never folded its task's latest run, read from facts that
// already exist: the task record marks that run as self-resumed (resumed_run_epoch === run_epoch)
// and it ended either not completed (a node that folded it would not read completed) or completed
// with an answer other than the node's persisted output. Without a persisted output the answer is
// unknown and the node is reused as before. A still-live resumed run is followed by the scheduler.
function endedUnfoldedResumedRun(
  task: TaskRecord,
  runId: DagRunId,
  nodeId: DagNodeId,
  persistedOutput: string | undefined,
): boolean {
  if (task.owner?.kind !== "dag" || task.owner.runId !== runId || task.owner.nodeId !== nodeId) return false
  if (task.resumed_run_epoch !== task.notification.run_epoch) return false
  if (task.status === "pending" || task.status === "running" || task.status === "paused") return false
  if (task.status !== "completed") return true
  return persistedOutput !== undefined && (task.final_response ?? "") !== persistedOutput
}
