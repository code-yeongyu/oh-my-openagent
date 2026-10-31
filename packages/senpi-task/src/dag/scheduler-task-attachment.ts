import type { TaskRecord, TaskStatus } from "../state"
import type { OwnedStartResult } from "./owner"
import { dagNodeTaskAttachedEvent } from "./events"
import { deferredSignal, errorMessage, failNode, nodeById, transition, type SchedulerContext, type AttachedTask, type AttachedTaskSettlement } from "./scheduler-context"
import type { DagNodeId, DagNodeErrorCode } from "./types"

export function attachStarted(
  context: SchedulerContext,
  nodeId: DagNodeId,
  result: Extract<OwnedStartResult, { readonly kind: "started" }>,
): void {
  const node = nodeById(context.journal.snapshot(), nodeId)
  const attempt = node.attempt + 1
  context.journal.append(dagNodeTaskAttachedEvent({ nodeId, taskId: result.task_id, attempt }))
  if (result.status === "pending") {
    if (!result.reused && result.queue_position !== undefined) {
      context.journal.append({
        type: "dag.node.transitioned",
        nodeId,
        from: "scheduled",
        to: "scheduled",
        reason: { kind: "task_queued", queuePosition: result.queue_position },
      })
    }
    watchQueuedPromotion(context, nodeId, result.task_id)
  } else if (result.status === "running") {
    transition(context, nodeId, "running", result.reused ? { kind: "resumed" } : { kind: "started" })
  }
  attachTaskSettlement(context, nodeId, result.task_id)
}

function watchQueuedPromotion(context: SchedulerContext, nodeId: DagNodeId, taskId: string): void {
  disposePromotionWatch(context, nodeId)
  const foldPromotion = (): void => {
    if (context.suspended || context.cancellationStarted) return
    if (context.taskManager.get(taskId)?.status !== "running") return
    disposePromotionWatch(context, nodeId)
    // A task can terminalize straight from the queue (cancelled/errored before launch); by the
    // time a stray event lands the node may already be folded, and a terminal node must never be
    // dragged back to running (that path is reserved for explicit revives).
    if (nodeById(context.journal.snapshot(), nodeId).state !== "scheduled") return
    transition(context, nodeId, "running", { kind: "started" })
  }
  const unsubscribe = context.taskManager.subscribeChild(taskId, foldPromotion)
  context.promotionWatches.set(nodeId, unsubscribe)
  // Level-triggered arm check: the queue can grant, launch, and flip the record to running between
  // startOwned's pending snapshot and this arm point, and a live-handle subscription never replays
  // missed events - without this a node promoted in that window sits "scheduled" until terminal.
  foldPromotion()
}

export function disposePromotionWatch(context: SchedulerContext, nodeId: DagNodeId): void {
  const dispose = context.promotionWatches.get(nodeId)
  if (dispose === undefined) return
  context.promotionWatches.delete(nodeId)
  dispose()
}

export function attachTaskSettlement(context: SchedulerContext, nodeId: DagNodeId, taskId: string): AttachedTask {
  context.attachedTaskIds.set(nodeId, taskId)
  const snapshot = context.journal.snapshot()
  const node = nodeById(snapshot, nodeId)
  for (const diagnostic of snapshot.diagnostics) {
    if (diagnostic.kind === "node_flag" && diagnostic.invalidatedBy !== undefined && node.dependsOn.includes(diagnostic.nodeId)) {
      flagConsumedDependents(context, diagnostic.nodeId, diagnostic.invalidatedBy)
    }
  }
  // Subscribe before waitFor can resolve: admission can yield while the completed child resumes.
  watchSelfResume(context, nodeId, taskId)
  const folded = deferredSignal()
  const task: AttachedTask = {
    nodeId,
    selfResumed: false,
    settled: context.taskManager.waitFor(taskId).then(
      (record): AttachedTaskSettlement => ({ nodeId, kind: "record", record }),
      (error: unknown): AttachedTaskSettlement => ({ nodeId, kind: "error", error }),
    ),
    folded: folded.promise,
    resolveFolded: folded.resolve,
  }
  context.attachedTasks.set(nodeId, task)
  context.resolveSettlementChanged()
  return task
}

export async function watchRevivedInScheduler(
  context: SchedulerContext,
  nodeId: DagNodeId,
  taskId: string,
): Promise<void> {
  const task = attachTaskSettlement(context, nodeId, taskId)
  await task.folded
}

export async function settleOne(context: SchedulerContext, residencyReleased?: Promise<void>): Promise<boolean> {
  if (context.infrastructureRetries.takeReady()) return true
  // #7412: a foreign commit can land while no settle race is armed (repeatableSignal wake-ups are
  // edge-triggered); consuming the flag first keeps that wake level-triggered.
  if (context.foreignSettlement) {
    context.foreignSettlement = false
    return true
  }
  const settled = await Promise.race([
    ...[...context.attachedTasks.values()].map((entry) => entry.settled),
    ...(residencyReleased === undefined ? [] : [residencyReleased.then(() => null)]),
    context.settlementChanged().then(() => null),
    context.cancellationRequested.then(() => undefined),
  ])
  if (settled === null) return true
  if (settled === undefined || context.suspended || context.cancellationStarted) return false
  const task = context.attachedTasks.get(settled.nodeId)
  context.attachedTasks.delete(settled.nodeId)
  context.attachedTaskIds.delete(settled.nodeId)
  disposePromotionWatch(context, settled.nodeId)
  try {
    if (task?.selfResumed) {
      // The announcement arrived while this attachment was still waiting to be folded. Its
      // resolved record belongs to the earlier run; waitFor now follows the resumed run instead.
      const taskId = nodeById(context.journal.snapshot(), settled.nodeId).taskId
      if (taskId !== undefined) attachTaskSettlement(context, settled.nodeId, taskId)
    } else if (settled.kind === "error") {
      failNode(context, settled.nodeId, "task_error", errorMessage(settled.error))
    } else {
      foldTaskOutcome(context, settled.nodeId, settled.record)
    }
  } finally {
    task?.resolveFolded()
  }
  return true
}

// omo#10487: a child whose turn completed can reopen itself (its background job or monitor wakes
// it). The node then follows the task: it goes back to running and folds the resumed run's outcome
// through the normal settle loop, so a resumed run that fails turns the node failed and the run
// summary counts it. Dependents admitted on the earlier completion keep their own outcome;
// dependents not yet admitted wait for the node again (or are skipped if it fails). Only a
// completed node is re-opened (an attached node instead discards its superseded settlement),
// and only while this scheduler runs: a terminal run is settled
// evidence (#7412), and the task's own resumed-turn notification still reaches the parent.
function watchSelfResume(context: SchedulerContext, nodeId: DagNodeId, taskId: string): void {
  disposeSelfResumeWatch(context, nodeId)
  const unsubscribe = context.taskManager.subscribeSelfResumed?.(taskId, () => {
    if (context.suspended || context.cancellationStarted) return
    const record = context.journal.snapshot()
    if (record.status !== "running") return
    const node = nodeById(record, nodeId)
    if (node.taskId !== taskId) return
    const attached = context.attachedTasks.get(nodeId)
    if (attached !== undefined) {
      attached.selfResumed = true
      return
    }
    if (node.state !== "completed") return
    disposeSelfResumeWatch(context, nodeId)
    transition(context, nodeId, "running", { kind: "resumed" })
    attachTaskSettlement(context, nodeId, taskId)
  })
  if (unsubscribe !== undefined) context.selfResumeWatches.set(nodeId, unsubscribe)
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

function foldTaskOutcome(context: SchedulerContext, nodeId: DagNodeId, task: TaskRecord): void {
  if (task.status === "pending" || task.status === "running" || task.status === "paused") {
    throw new Error(`TaskManager.waitFor returned nonterminal task ${task.task_id}`)
  }
  context.pendingTerminalResults.set(nodeId, { record: task })
  if (task.status === "completed") {
    transition(context, nodeId, "completed", { kind: "succeeded" })
    return
  }
  const failure = taskFailure(task.status, task.error_message)
  const selfResumed = task.resumed_run_epoch === task.notification.run_epoch
  if (selfResumed) flagConsumedDependents(context, nodeId)
  failNode(context, nodeId, failure.code, failure.message)
  // A self-resumed run is a continuation of output already consumed by other nodes, not a fresh
  // attempt. Its outcome must remain visible, including typed infrastructure failures (#10487).
  if (!selfResumed) context.infrastructureRetries.retry(nodeId, task)
}

function flagConsumedDependents(context: SchedulerContext, nodeId: DagNodeId, invalidatedBy = nodeId): void {
  const { nodes, diagnostics } = context.journal.snapshot()
  const flagged = new Set(diagnostics.flatMap((entry) =>
    entry.kind === "node_flag" && entry.invalidatedBy !== undefined ? [entry.nodeId] : []))
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

function taskFailure(status: Exclude<TaskStatus, "completed" | "pending" | "running" | "paused">, message?: string): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (status) {
    case "error":
      return { code: "task_error", message: message ?? "task failed" }
    case "interrupted":
      return { code: "task_interrupted", message: message ?? "task was interrupted" }
    case "lost":
      return { code: "task_lost", message: message ?? "task was lost" }
    case "cancelled":
      return { code: "task_cancelled", message: message ?? "task was cancelled" }
    default: {
      const exhaustive: never = status
      throw new Error(`unexpected task status ${String(exhaustive)}`)
    }
  }
}
