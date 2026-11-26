import { selfResumeVerdict } from "./owner-resume-fence"
import { nodeById, transition, type SchedulerContext } from "./scheduler-context"
import { attachTaskSettlement } from "./scheduler-task-attachment"
import type { DagNodeId } from "./types"

// The node task a self-resume watch was armed for.
type NodeTaskBinding = { readonly nodeId: DagNodeId; readonly taskId: string }

// omo#10487 / #12134: whether this scheduler re-opens a node to follow a turn its child started on
// its own. Whether that turn may run at all is the one decision the manager's fence also asks
// (`selfResumeVerdict`: the node's current claim, a run neither settled nor being cancelled); the
// rest only says that THIS scheduler holds the run now and the task is the node's own. A turn allowed
// while no scheduler holds the run (a paused run) is followed by the scheduler that next holds it.
function followsNodeTask(context: SchedulerContext, binding: NodeTaskBinding): boolean {
  const record = context.journal.snapshot()
  if (context.suspended || record.status !== "running") return false
  const task = context.taskManager.get(binding.taskId)
  const owner = task?.owner
  if (task === undefined || owner?.kind !== "dag" || owner.runId !== record.runId) return false
  if (owner.nodeId !== binding.nodeId) return false
  if (selfResumeVerdict(task, record, context.cancellationStarted).kind !== "allow") return false
  return nodeById(record, binding.nodeId).taskId === binding.taskId
}

// A child whose turn completed can reopen itself (its background job or monitor wakes it). The node
// then follows the task: it goes back to running and folds the resumed run's outcome through the
// normal settle loop, so a resumed run that fails turns the node failed and the run summary counts
// it. Dependents admitted on the earlier completion keep their own outcome; dependents not yet
// admitted wait for the node again (or are skipped if it fails). Only a completed node is re-opened
// (an attached node instead discards its superseded settlement). A turn started while the run is
// being cancelled is refused, never followed: the run-wide stop (#15135) stops it with the rest.
export function watchSelfResume(context: SchedulerContext, nodeId: DagNodeId, taskId: string): NodeTaskBinding {
  disposeSelfResumeWatch(context, nodeId)
  const binding: NodeTaskBinding = { nodeId, taskId }
  const unsubscribe = context.taskManager.subscribeSelfResumed?.(taskId, () => followSelfResume(context, binding))
  if (unsubscribe !== undefined) context.selfResumeWatches.set(nodeId, unsubscribe)
  return binding
}

// A scheduler that takes over a running run (recovery, re-entry) only arms watches through
// attachment, which completed nodes never pass again. Watch each completed node's task, and follow
// one whose child already resumed on its own before this scheduler held the run.
export function followCompletedNodeTasks(context: SchedulerContext): void {
  for (const node of context.journal.snapshot().nodes) {
    if (node.state !== "completed" || node.taskId === undefined) continue
    const binding = watchSelfResume(context, node.id, node.taskId)
    const task = context.taskManager.get(node.taskId)
    const live = task?.status === "pending" || task?.status === "running" || task?.status === "paused"
    if (live && task.resumed_run_epoch === task.notification.run_epoch) followSelfResume(context, binding)
  }
}

function followSelfResume(context: SchedulerContext, binding: NodeTaskBinding): void {
  if (!followsNodeTask(context, binding)) return
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

// A residency-denied node was scheduled but never admitted. If a dependency stopped being completed
// meanwhile (its child resumed on its own, #12134), it returns to the frontier and waits for that
// dependency's resumed outcome like any pending node; it is skipped if that outcome fails.
export function stillAdmissible(context: SchedulerContext, denied: readonly DagNodeId[]): DagNodeId[] {
  const admissible: DagNodeId[] = []
  for (const nodeId of denied) {
    const snapshot = context.journal.snapshot()
    const ready = nodeById(snapshot, nodeId).dependsOn.every(
      (dependencyId) => nodeById(snapshot, dependencyId).state === "completed",
    )
    if (ready) {
      admissible.push(nodeId)
      continue
    }
    context.residencyQueued.delete(nodeId)
    // Same shape recovery uses for a scheduled node it could not admit (recovery.ts).
    transition(context, nodeId, "pending", { kind: "resumed" })
  }
  return admissible
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
      // Scheduled without an attached task: denied residency, never admitted, consumed nothing.
      if (node.state === "scheduled" && !context.attachedTaskIds.has(node.id)) continue
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
