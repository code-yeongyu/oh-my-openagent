import type { PendingRevivals } from "../lifecycle/revival-pending"
import { isTerminalRecord } from "../manager/manager-helpers"
import { orphanedTaskReason } from "./child-backing"
import { childStartRefusal, staleLiveRefusal } from "./child-gate"
import { disposeSupersededChildren, supersededChildren } from "./scheduler-cancellation"
import {
  deferredSignal,
  isLiveOwnedTask,
  type AttachedTaskSettlement,
  type SchedulerContext,
} from "./scheduler-context"
import type { TaskRecord } from "../state"
import type { DagNodeId } from "./types"

export type AwaitingRevival = {
  readonly tasks: ReadonlyMap<DagNodeId, string>
  readonly revivals: PendingRevivals
}

/**
 * A recovered node whose child this host's lifecycle still owes a revival (#15150) sits in the settle
 * loop like an attached child, so its dependents wait and the run never parks as unattached. It ends
 * only on the lifecycle's own end, never on a clock of its own: the child is revived or its record turns
 * terminal (the lifecycle's expiry included) - the child gate is asked (`gateDecision`), and the node is
 * then attached through the one attachment path, which follows a self-resumed or held turn and folds once - the
 * lifecycle has no obligation left (the node fails as orphaned), or the lifecycle stopped for shutdown
 * or was disposed (the node is released unjournaled and the run parks). Each lifecycle pass wakes it.
 */
export function followPendingRevivals(context: SchedulerContext, awaiting: AwaitingRevival): void {
  for (const [nodeId, taskId] of awaiting.tasks) {
    const folded = deferredSignal()
    context.attachedTaskIds.set(nodeId, taskId)
    context.attachedTasks.set(nodeId, {
      nodeId,
      selfResumed: false,
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
  const flagged = new Set<string>()
  for (;;) {
    const record = context.taskManager.get(taskId)
    if (
      record !== undefined &&
      (isTerminalRecord(record) || context.taskManager.getResidentHandle(taskId) !== undefined)
    ) {
      const decision = await gateDecision(context, nodeId, record, flagged)
      if (decision === "again") continue
      if (decision !== "wait") return decision
    } else {
      const ended = obligationEnd(revivals, nodeId, taskId, record)
      if (ended !== undefined) return ended
    }
    // A cancelled or suspended scheduler stops listening; its settle loop has already returned.
    const woken = await Promise.race([
      revivals.changed().then(() => true),
      context.cancellationRequested.then(() => false),
    ])
    if (!woken) return new Promise<AttachedTaskSettlement>(() => undefined)
  }
}

function obligationEnd(
  revivals: PendingRevivals,
  nodeId: DagNodeId,
  taskId: string,
  record: TaskRecord | undefined,
): AttachedTaskSettlement | undefined {
  const obligation = record === undefined ? "none" : revivals.obligation(taskId)
  if (obligation === "stopped") return { nodeId, kind: "released" }
  if (record === undefined || obligation === "none") {
    const message = record === undefined ? `task ${taskId} has no record left to revive` : orphanedTaskReason(record)
    return { nodeId, kind: "orphaned", message }
  }
  return undefined
}

/**
 * Following a revived child attaches it, so the child gate decides first (#11381), and each refusal gets
 * that rule's own action:
 * - `stale_live`: another task (a superseded attempt or a removed node's child) is live. It is stopped by
 *   the scheduler's fence, the same stop admission uses (each asked once per scheduler), and the gate is
 *   asked again; the node's own child is never stopped for it. A stale child whose stop is not confirmed
 *   keeps the node waiting, flagged once, until a lifecycle pass after a store change (the survivor's
 *   stop landing) or the run's cancel ends the wait.
 * - `not_current`: the child in hand is itself not the node's current attempt. It is stopped through the
 *   same fence; a confirmed stop fails the node `stale_attempt_alive`, an unconfirmed one keeps the node
 *   active as a survivor (it may still run) until that stop lands.
 * - `stop_owed`: only a settled run owes a stop, and a scheduler that is still following its nodes holds
 *   a running run, so this cannot be reached here; were it, the node waits for the run's cancel to drain it.
 */
async function gateDecision(
  context: SchedulerContext,
  nodeId: DagNodeId,
  record: TaskRecord,
  flagged: Set<string>,
): Promise<AttachedTaskSettlement | "again" | "wait"> {
  const refusal = childStartRefusal(context.taskManager, context.journal.snapshot(), record)
  if (refusal === undefined) return { nodeId, kind: "followed", taskId: record.task_id }
  if (refusal.rule === "stale_live") {
    await disposeSupersededChildren(context, supersededChildren(context))
    const alive = supersededChildren(context).filter(({ taskId }) => taskId !== record.task_id)
    if (alive.length === 0) return "again"
    flagOnce(context, nodeId, flagged, `${staleLiveRefusal(alive)}; the node waits until its stop lands`)
    return "wait"
  }
  if (refusal.rule === "not_current") {
    await disposeSupersededChildren(context, [{ nodeId, taskId: record.task_id }])
    if (!isLiveOwnedTask(context.taskManager, context.taskManager.get(record.task_id))) {
      return { nodeId, kind: "refused", message: refusal.message }
    }
    const message = `${refusal.message}; it was asked to stop and is still live, so the node stays active until its stop lands`
    flagOnce(context, nodeId, flagged, message)
    return "wait"
  }
  flagOnce(context, nodeId, flagged, refusal.message)
  return "wait"
}

function flagOnce(context: SchedulerContext, nodeId: DagNodeId, flagged: Set<string>, message: string): void {
  if (flagged.has(message)) return
  flagged.add(message)
  context.journal.append({
    type: "dag.diagnostic.added",
    diagnostic: { kind: "node_flag", nodeId, message, at: new Date(context.now()).toISOString() },
  })
}
