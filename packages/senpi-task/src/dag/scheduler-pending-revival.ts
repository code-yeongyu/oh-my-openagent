import type { PendingRevivals } from "../lifecycle/revival-pending"
import { isTerminalRecord } from "../manager/manager-helpers"
import { orphanedTaskReason } from "./child-backing"
import { childStartRefusal, staleLiveRefusal } from "./child-gate"
import { disposeSupersededChildren, supersededChildren } from "./scheduler-cancellation"
import { ownedClaimAge } from "./owned-attempt"
import {
  deferredSignal,
  failNode,
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
/**
 * The waiter's invariant (#15150 stack review 3): after its first decision a waiter never decides again
 * without having awaited an event - the lifecycle's pass signal, the cancellation signal, or (once it
 * follows) its own child's settlement. The loop in `revivalSettlement` enforces it: every decision after
 * the first is preceded by that await. A waiter armed "after an event" (the frontier re-arming a node whose
 * stop is unconfirmed) has already decided once, so it awaits an event before its first decision too; the
 * frontier never re-arms a waiter that could settle again on microtasks alone.
 */
export type WaiterArm = "first decision" | "after an event"

export function followPendingRevivals(context: SchedulerContext, awaiting: AwaitingRevival, arm: WaiterArm): void {
  for (const [nodeId, taskId] of awaiting.tasks) {
    const folded = deferredSignal()
    context.attachedTaskIds.set(nodeId, taskId)
    context.attachedTasks.set(nodeId, {
      nodeId,
      selfResumed: false,
      settled: revivalSettlement(context, nodeId, taskId, awaiting.revivals, arm),
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
  arm: WaiterArm,
): Promise<AttachedTaskSettlement> {
  for (let awaitEvent = arm === "after an event"; ; awaitEvent = true) {
    if (awaitEvent) {
      // A cancelled or suspended scheduler stops listening; its settle loop has already returned.
      const woken = await Promise.race([
        revivals.changed().then(() => true),
        context.cancellationRequested.then(() => false),
      ])
      if (!woken) return new Promise<AttachedTaskSettlement>(() => undefined)
    }
    const record = context.taskManager.get(taskId)
    if (
      record !== undefined &&
      (isTerminalRecord(record) || context.taskManager.getResidentHandle(taskId) !== undefined)
    ) {
      const decision = gateDecision(context, nodeId, record, revivals)
      if (decision !== "wait") return decision
    } else {
      const ended = obligationEnd(revivals, nodeId, taskId, record)
      if (ended !== undefined) return ended
    }
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
 * Following a revived child attaches it, so the child gate decides first (#11381). The waiter only
 * decides; anything it stops is stopped by the frontier (`runRevivalFences`), never from here:
 * - `stale_live`: another task of the run (a superseded attempt or a removed node's child) is live. The
 *   node follows its own child either way - acting on it starts nothing - and the frontier fences the
 *   stale children once; a survivor is flagged on the node. A dependent's start stays behind admission's
 *   own fence, which refuses it retryably (`stale_attempt_alive`) while the survivor is live.
 * - `not_current`: the child in hand is itself not the node's current attempt; the frontier stops it and
 *   fails the node `stale_attempt_alive` on a confirmed stop, or keeps it waiting, flagged, until the stop
 *   lands (a run cancel's drain ends it otherwise).
 * - `stop_owed`: only a settled run owes a stop, and a scheduler still following its nodes holds a running
 *   run, so this cannot be reached here; were it, the node waits for the run's cancel to drain it.
 */
function gateDecision(
  context: SchedulerContext,
  nodeId: DagNodeId,
  record: TaskRecord,
  revivals: PendingRevivals,
): AttachedTaskSettlement | "wait" {
  const run = context.journal.snapshot()
  const refusal = childStartRefusal(context.taskManager, run, record)
  if (refusal === undefined) return { nodeId, kind: "followed", taskId: record.task_id, fenceStale: false }
  if (refusal.rule === "stop_owed") return "wait"
  if (ownedClaimAge(record, run) === "current") {
    return { nodeId, kind: "followed", taskId: record.task_id, fenceStale: true }
  }
  const message = `task ${record.task_id} belongs to an earlier attempt of DAG node "${nodeId}", not its current one`
  return { nodeId, kind: "not_current", taskId: record.task_id, message, revivals }
}

/**
 * The fences waiting nodes' folds asked for, run by the frontier between admission passes (#15150). The
 * run's stale children - and any child in hand that is not its node's current attempt - are stopped by
 * the scheduler's one stop (`disposeSupersededChildren`, each asked once per scheduler), then read again.
 */
export async function runRevivalFences(context: SchedulerContext): Promise<void> {
  const requests = [...context.revivalFences]
  context.revivalFences.clear()
  const stale = supersededChildren(context)
  const inHand = requests.flatMap(([nodeId, request]) =>
    request.rule === "not_current" && !stale.some(({ taskId }) => taskId === request.taskId)
      ? [{ nodeId, taskId: request.taskId }]
      : [],
  )
  await disposeSupersededChildren(context, [...stale, ...inHand])
  if (context.suspended || context.cancellationStarted) return
  const alive = supersededChildren(context)
  for (const [nodeId, request] of requests) {
    if (request.rule === "stale_live") {
      const survivors = alive.filter(({ taskId }) => taskId !== request.taskId)
      const refusal = staleLiveRefusal(survivors)
      if (refusal !== undefined) flagOnce(context, nodeId, `${refusal}; no dependent is admitted while it is live`)
      continue
    }
    if (!isLiveOwnedTask(context.taskManager, context.taskManager.get(request.taskId))) {
      failNode(context, nodeId, "stale_attempt_alive", request.message)
      continue
    }
    flagOnce(
      context,
      nodeId,
      `${request.message}; it was asked to stop and is still live, so the node waits until its stop lands`,
    )
    // Re-armed after an event only: its child just answered not_current, and would again at once.
    followPendingRevivals(
      context,
      { tasks: new Map([[nodeId, request.taskId]]), revivals: request.revivals },
      "after an event",
    )
  }
}

// Once per node and message, from the run's own diagnostics, so a re-armed waiter does not repeat it.
function flagOnce(context: SchedulerContext, nodeId: DagNodeId, message: string): void {
  const flagged = context.journal
    .snapshot()
    .diagnostics.some((entry) => entry.kind === "node_flag" && entry.nodeId === nodeId && entry.message === message)
  if (flagged) return
  context.journal.append({
    type: "dag.diagnostic.added",
    diagnostic: { kind: "node_flag", nodeId, message, at: new Date(context.now()).toISOString() },
  })
}
