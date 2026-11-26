import { nodeById, transition, type SchedulerContext } from "./scheduler-context"
import { attachTaskSettlement } from "./scheduler-task-attachment"
import type { DagNodeId } from "./types"

// The node task a self-resume watch was armed for: the task id plus the execution attempt the node
// held it under. A retried node claims a new execAttempt, so an old task can never reopen it.
type NodeTaskBinding = { readonly nodeId: DagNodeId; readonly taskId: string; readonly execAttempt: number }

// omo#10487 / #12134: the one rule for who may re-open a node after its child resumed on its own.
// Only the scheduler that holds the run, while the run is still running (cancellation included,
// until the run is journaled cancelled), and only for the node's current task under the same
// execution attempt, owned by this run and node.
function holdsNodeTask(context: SchedulerContext, binding: NodeTaskBinding): boolean {
  if (context.suspended) return false
  const record = context.journal.snapshot()
  if (record.status !== "running") return false
  const node = nodeById(record, binding.nodeId)
  if (node.taskId !== binding.taskId || (node.execAttempt ?? 0) !== binding.execAttempt) return false
  const owner = context.taskManager.get(binding.taskId)?.owner
  return owner?.kind === "dag" && owner.runId === record.runId && owner.nodeId === binding.nodeId
}

// A child whose turn completed can reopen itself (its background job or monitor wakes it). The node
// then follows the task: it goes back to running and folds the resumed run's outcome through the
// normal settle loop, so a resumed run that fails turns the node failed and the run summary counts
// it. Dependents admitted on the earlier completion keep their own outcome; dependents not yet
// admitted wait for the node again (or are skipped if it fails). Only a completed node is re-opened
// (an attached node instead discards its superseded settlement). A reopen during cancellation
// attaches the task, and cancellation drains attached tasks until none is left uncancelled.
export function watchSelfResume(context: SchedulerContext, nodeId: DagNodeId, taskId: string): void {
  disposeSelfResumeWatch(context, nodeId)
  const execAttempt = nodeById(context.journal.snapshot(), nodeId).execAttempt ?? 0
  const binding: NodeTaskBinding = { nodeId, taskId, execAttempt }
  const unsubscribe = context.taskManager.subscribeSelfResumed?.(taskId, () => followSelfResume(context, binding))
  if (unsubscribe !== undefined) context.selfResumeWatches.set(nodeId, unsubscribe)
}

function followSelfResume(context: SchedulerContext, binding: NodeTaskBinding): void {
  if (!holdsNodeTask(context, binding)) return
  const attached = context.attachedTasks.get(binding.nodeId)
  if (attached !== undefined) {
    attached.selfResumed = true
    return
  }
  if (nodeById(context.journal.snapshot(), binding.nodeId).state !== "completed") return
  transition(context, binding.nodeId, "running", { kind: "resumed" })
  attachTaskSettlement(context, binding.nodeId, binding.taskId)
}

function disposeSelfResumeWatch(context: SchedulerContext, nodeId: DagNodeId): void {
  const dispose = context.selfResumeWatches.get(nodeId)
  if (dispose === undefined) return
  context.selfResumeWatches.delete(nodeId)
  dispose()
}

export function disposeSelfResumeWatches(context: SchedulerContext): void {
  for (const nodeId of [...context.selfResumeWatches.keys()]) disposeSelfResumeWatch(context, nodeId)
}

export function flagConsumedDependents(context: SchedulerContext, nodeId: DagNodeId, invalidatedBy = nodeId): void {
  const { nodes, diagnostics } = context.journal.snapshot()
  const flagged = new Set(
    diagnostics.flatMap((entry) =>
      entry.kind === "node_flag" && entry.invalidatedBy !== undefined ? [entry.nodeId] : [],
    ),
  )
  const invalidated = new Set([nodeId])
  for (const dependencyId of invalidated) {
    for (const node of nodes) {
      if (invalidated.has(node.id) || !node.dependsOn.includes(dependencyId)) continue
      if (node.state === "pending" || node.state === "blocked" || node.state === "skipped") continue
      invalidated.add(node.id)
      if (flagged.has(node.id)) continue
      context.journal.append({
        type: "dag.diagnostic.added",
        diagnostic: {
          kind: "node_flag",
          nodeId: node.id,
          invalidatedBy,
          message: `input from ${invalidatedBy} was invalidated by its resumed failure; this node retains its own outcome`,
          at: new Date(context.now()).toISOString(),
        },
      })
    }
  }
}
