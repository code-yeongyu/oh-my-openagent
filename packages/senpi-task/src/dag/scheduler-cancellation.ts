import { dagRunCancelledEvent } from "./events"
import {
  countNodes,
  errorMessage,
  failNode,
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

// One stop attempt per stale task id per scheduler: the re-entry sweep and every admission fence share
// it, so a child that refused to stop is reported, not hammered, and a retry's fresh scheduler re-asks.
const staleStops = new WeakMap<SchedulerContext, Map<string, string | undefined>>()

/** Stops the live superseded or removed-node children not yet asked; a rejected stop keeps its message. */
export async function disposeSupersededChildren(
  context: SchedulerContext,
  stale: readonly SupersededChild[],
): Promise<void> {
  const asked = staleStops.get(context) ?? new Map<string, string | undefined>()
  staleStops.set(context, asked)
  const fresh = stale.filter(({ taskId }) => !asked.has(taskId))
  if (fresh.length === 0) return
  for (const { taskId } of fresh) asked.set(taskId, undefined)
  context.admissionInProgress = true
  try {
    const results = await Promise.allSettled(
      fresh.map(({ nodeId, taskId }) => context.taskManager.cancelTask(taskId, supersededReason(context, nodeId))),
    )
    fresh.forEach(({ taskId }, index) => {
      const result = results[index]
      if (result?.status === "rejected") asked.set(taskId, errorMessage(result.reason))
    })
  } finally {
    context.admissionInProgress = false
    resolveAdmissionIdle(context)
  }
}

/**
 * No node is admitted in a pass after which a superseded or removed-node child is still live (#11381):
 * live stale children are asked to stop, and if any survives, every node this pass would admit fails
 * with the retryable `stale_attempt_alive`. Failing the ready nodes rather than the run is what node
 * retry already recovers from: it re-enters, sweeps, and admits once the stop has landed. Runs as an
 * admission pass, so cancel and suspend wait for it. Called only when `stale` is non-empty, so a run
 * with nothing stale admits without yielding. Returns the nodes still admissible.
 */
export async function fenceStaleChildren(
  context: SchedulerContext,
  stale: readonly SupersededChild[],
  nodeIds: readonly DagNodeId[],
): Promise<readonly DagNodeId[]> {
  await disposeSupersededChildren(context, stale)
  if (context.suspended || context.cancellationStarted) return []
  const alive = supersededChildren(context)
  if (alive.length === 0) return nodeIds
  const ids = alive.map(({ taskId }) => {
    const cause = staleStops.get(context)?.get(taskId)
    return cause === undefined ? taskId : `${taskId} (${cause})`
  })
  const message = `task ${ids.join(", ")} of a superseded attempt or removed node is still live and could not be stopped`
  for (const nodeId of nodeIds) failNode(context, nodeId, "stale_attempt_alive", message)
  return []
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
