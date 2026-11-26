import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import { dagNodeReusedEvent, dagNodeTransitionedEvent } from "./events"
import type { DagJournal } from "./journal"
import type { DagRunRecordV1 } from "./manager"
import {
  dagNodeResultContents,
  readDagNodeResult,
  readDagNodeResultContents,
  type DagNodeResultContents,
} from "./results"
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
  const stored = readDagNodeResultContents({ store: recovery.store, runId, nodeId: node.id })
  const task = node.taskId === undefined ? undefined : recovery.taskManager.get(node.taskId)
  if (task !== undefined && endedUnfoldedResumedRun(task, runId, node.id, stored)) {
    recovery.journal.append(
      dagNodeTransitionedEvent({ nodeId: node.id, from: "completed", to: "running", reason: { kind: "resumed" } }),
    )
    recovery.reattachedTasks.set(node.id, task.task_id)
    return
  }
  const result = readDagNodeResult({ store: recovery.store, runId, nodeId: node.id })
  if (result === null) return
  recovery.reusedOutputs.set(node.id, result.output)
  if (node.taskId !== undefined) {
    recovery.journal.append(dagNodeReusedEvent({ nodeId: node.id, taskId: node.taskId, sourceRunId: runId }))
  }
}

// Durable evidence that a completed node never folded its task's latest run, read from facts that
// already exist: the task record marks that run as self-resumed (resumed_run_epoch === run_epoch)
// and it ended either not completed (a node that folded it would not read completed) or completed
// with an outcome other than what the node holds. "What the node holds" is everything a completed
// fold derives from the task record and persists (the response artifact and the run_stats sidecar,
// which the node's output preview and runStats are projected from), derived for the resumed run by
// the same function the fold writes with. Any difference, a missing persisted result included,
// re-folds; only a byte-identical outcome is left alone. completedAt is the fold's own journal time,
// not part of the task's outcome. A still-live resumed run is followed by the scheduler.
function endedUnfoldedResumedRun(
  task: TaskRecord,
  runId: DagRunId,
  nodeId: DagNodeId,
  stored: DagNodeResultContents | null,
): boolean {
  if (task.owner?.kind !== "dag" || task.owner.runId !== runId || task.owner.nodeId !== nodeId) return false
  if (task.resumed_run_epoch !== task.notification.run_epoch) return false
  if (task.status === "pending" || task.status === "running" || task.status === "paused") return false
  if (task.status !== "completed") return true
  const resumed = dagNodeResultContents({ runId, nodeId, record: task })
  return stored === null || stored.output !== resumed.output || stored.stats !== resumed.stats
}
