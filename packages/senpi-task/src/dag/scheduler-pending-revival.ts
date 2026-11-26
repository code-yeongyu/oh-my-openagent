import type { PendingRevivals } from "../lifecycle/revival-pending"
import { isTerminalRecord } from "../manager/manager-helpers"
import { orphanedTaskReason } from "./child-backing"
import {
  deferredSignal,
  nodeById,
  transition,
  type AttachedTaskSettlement,
  type SchedulerContext,
} from "./scheduler-context"
import type { DagNodeId } from "./types"

export type AwaitingRevival = {
  readonly tasks: ReadonlyMap<DagNodeId, string>
  readonly revivals: PendingRevivals
}

/**
 * A recovered node whose child this host's lifecycle still owes a revival (#15150) sits in the settle
 * loop like an attached child, so its dependents wait and the run never parks as unattached. It settles
 * when the pending state ends: the child is revived (the node follows its outcome), its record turns
 * terminal (the node folds that outcome), or the lifecycle no longer owes it a revival - its recovery
 * deadline passed or its owner is gone - and the node fails as orphaned. Each lifecycle pass wakes it.
 */
export function followPendingRevivals(context: SchedulerContext, awaiting: AwaitingRevival): void {
  for (const [nodeId, taskId] of awaiting.tasks) {
    const folded = deferredSignal()
    context.attachedTaskIds.set(nodeId, taskId)
    context.attachedTasks.set(nodeId, {
      nodeId,
      settled: revivalSettlement(context, nodeId, taskId, awaiting.revivals),
      folded: folded.promise,
      resolveFolded: folded.resolve,
    })
  }
  context.resolveSettlementChanged()
}

async function revivalSettlement(
  context: SchedulerContext,
  nodeId: DagNodeId,
  taskId: string,
  revivals: PendingRevivals,
): Promise<AttachedTaskSettlement> {
  for (;;) {
    const record = context.taskManager.get(taskId)
    if (record !== undefined && isTerminalRecord(record)) return { nodeId, kind: "record", record }
    if (record !== undefined && context.taskManager.getResidentHandle(taskId) !== undefined) {
      if (nodeById(context.journal.snapshot(), nodeId).state === "scheduled") {
        transition(context, nodeId, "running", { kind: "resumed" })
      }
      return context.taskManager.waitFor(taskId).then(
        (settled): AttachedTaskSettlement => ({ nodeId, kind: "record", record: settled }),
        (error: unknown): AttachedTaskSettlement => ({ nodeId, kind: "error", error }),
      )
    }
    if (record === undefined || !revivals.pending(taskId)) {
      const message = record === undefined ? `task ${taskId} has no record left to revive` : orphanedTaskReason(record)
      return { nodeId, kind: "orphaned", message }
    }
    // A cancelled or suspended scheduler stops listening; its settle loop has already returned.
    const woken = await Promise.race([
      revivals.changed().then(() => true),
      context.cancellationRequested.then(() => false),
    ])
    if (!woken) return new Promise<AttachedTaskSettlement>(() => undefined)
  }
}
