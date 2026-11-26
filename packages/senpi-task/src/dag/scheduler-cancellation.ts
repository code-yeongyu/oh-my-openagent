import { dagRunCancelledEvent } from "./events"
import {
  countNodes,
  errorMessage,
  failNode,
  isLiveTask,
  transition,
  TERMINAL_NODE_STATES,
  type SchedulerContext,
} from "./scheduler-context"
import { ownedClaimAge } from "./owned-attempt"
import { disposePromotionWatch } from "./scheduler-task-attachment"
import { liveRunChildren, stopRunChildren, stopSettledRunChildren } from "./run-children-stop"
import type { DagNodeId, DagRunId } from "./types"
import type { DagRunRecordV1 } from "./manager"

export async function cancelRun(context: SchedulerContext, runId: DagRunId, reason?: string): Promise<void> {
  const snapshot = context.journal.snapshot()
  if (snapshot.runId !== runId) throw new Error(`scheduler does not own DAG run "${runId}"`)
  // A settled run keeps no node to cancel, but a child it owns can still be live (#11381).
  if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") {
    return stopSettledRunChildren(context.taskManager, snapshot, reason)
  }
  if (context.cancellationOperation !== undefined) return context.cancellationOperation

  context.cancellationStarted = true
  context.infrastructureRetries.cancelPendingTimers()
  context.resolveCancellationRequested()
  context.cancellationOperation = performCancellation(context, reason)
  return context.cancellationOperation
}

async function performCancellation(context: SchedulerContext, reason?: string): Promise<void> {
  try {
    await whenAdmissionIdle(context)
    // Watches go first so a promotion racing the cancel cannot flip nodes mid-cancellation.
    for (const nodeId of [...context.promotionWatches.keys()]) disposePromotionWatch(context, nodeId)
    const failure = await stopRunChildren(
      context.taskManager,
      context.journal.snapshot(),
      new Set(context.attachedTaskIds.values()),
      reason,
    )
    const cancelledNodeIds: DagNodeId[] = []
    for (const node of context.journal.snapshot().nodes) {
      if (TERMINAL_NODE_STATES.has(node.state)) continue
      transition(context, node.id, "cancelled", { kind: "cancelled" })
      cancelledNodeIds.push(node.id)
    }
    const cancelled = context.journal.snapshot()
    context.journal.append(
      Object.assign(dagRunCancelledEvent({ reason, counts: countNodes(cancelled.nodes) }), { cancelledNodeIds }),
    )
    context.attachedTaskIds.clear()
    if (failure !== undefined) throw failure
  } finally {
    context.resolveCancellationCompleted()
  }
}

export async function cancelledSnapshot(context: SchedulerContext): Promise<DagRunRecordV1> {
  if (context.suspended && !context.cancellationStarted) return context.journal.snapshot()
  await context.cancellationCompleted
  return context.journal.snapshot()
}

type SupersededChild = { readonly nodeId: DagNodeId; readonly taskId: string }

/**
 * Live children the run owns that no longer belong to any current attempt: an earlier attempt of a
 * node (an amend or a retry bumped its execAttempt), the newest record or not, or a node an amendment
 * removed. An older attempt's child can resume after the next attempt's task exists.
 */
export function supersededChildren(context: SchedulerContext): readonly SupersededChild[] {
  const record = context.journal.snapshot()
  return liveRunChildren(context.taskManager, record).flatMap((task) =>
    task.owner === undefined || ownedClaimAge(task, record) !== "superseded"
      ? []
      : [{ nodeId: task.owner.nodeId, taskId: task.task_id }],
  )
}

/**
 * Stops superseded children before any new attempt starts, so a replaced definition never keeps
 * writing beside, or gets adopted as, the new one (#11381). A child that cannot be stopped fails its
 * node with the retryable `stale_attempt_alive`. Runs as an admission pass, so cancel and suspend
 * wait for it.
 */
export async function disposeSupersededChildren(
  context: SchedulerContext,
  stale: readonly SupersededChild[],
): Promise<void> {
  context.admissionInProgress = true
  let results: PromiseSettledResult<unknown>[]
  try {
    results = await Promise.allSettled(
      stale.map(({ nodeId, taskId }) => context.taskManager.cancelTask(taskId, supersededReason(context, nodeId))),
    )
  } finally {
    context.admissionInProgress = false
    resolveAdmissionIdle(context)
  }
  if (context.suspended || context.cancellationStarted) return
  stale.forEach(({ nodeId, taskId }, index) => {
    const task = context.taskManager.get(taskId)
    if (!isLiveTask(task)) return
    // Only a node still to be admitted can fail closed; an already settled or attached node keeps its
    // state, and a removed node has none - its child stays the run cancel's to stop.
    const state = context.journal.snapshot().nodes.find((node) => node.id === nodeId)?.state
    if (state !== "pending" && state !== "blocked") return
    const result = results[index]
    const cause = result?.status === "rejected" ? `: ${errorMessage(result.reason)}` : ""
    failNode(
      context,
      nodeId,
      "stale_attempt_alive",
      `task ${taskId} of a superseded attempt is still ${task?.status} and could not be stopped${cause}`,
    )
  })
}

function supersededReason(context: SchedulerContext, nodeId: DagNodeId): string {
  const node = context.journal.snapshot().nodes.find((entry) => entry.id === nodeId)
  return node === undefined
    ? `DAG node "${nodeId}" was removed by an amendment`
    : `superseded by attempt ${node.execAttempt ?? 0} of DAG node "${nodeId}"`
}

export function whenAdmissionIdle(context: SchedulerContext): Promise<void> {
  if (!context.admissionInProgress) return Promise.resolve()
  return new Promise<void>((resolve) => context.admissionIdleWaiters.add(resolve))
}

export function resolveAdmissionIdle(context: SchedulerContext): void {
  for (const resolve of context.admissionIdleWaiters) resolve()
  context.admissionIdleWaiters.clear()
}
