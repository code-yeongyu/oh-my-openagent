import { dagRunCancelledEvent } from "./events"
import { countNodes, transition, TERMINAL_NODE_STATES, type SchedulerContext } from "./scheduler-context"
import { disposePromotionWatch } from "./scheduler-task-attachment"
import type { DagNodeId, DagRunId } from "./types"
import type { DagRunRecordV1 } from "./manager"

export async function cancelRun(context: SchedulerContext, runId: DagRunId, reason?: string): Promise<void> {
  const snapshot = context.journal.snapshot()
  if (snapshot.runId !== runId) throw new Error(`scheduler does not own DAG run "${runId}"`)
  if (snapshot.status === "completed" || snapshot.status === "failed" || snapshot.status === "cancelled") return
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
    // A node's child can resume on its own until the run is journaled cancelled (#12134): a
    // completed node's reopen attaches its task, and a finished child whose cancel was a noop can
    // start a new run. Each request is fenced to the run epoch it names, and the drain repeats
    // until every attached task's current run was asked once.
    const requested = new Set<string>()
    const cancellationResults: PromiseSettledResult<unknown>[] = []
    for (;;) {
      const targets = [...context.attachedTaskIds.values()].flatMap((taskId) => {
        const runEpoch = context.taskManager.get(taskId)?.notification.run_epoch
        const asked = `${taskId}@${runEpoch ?? "unknown"}`
        return requested.has(asked) ? [] : [{ taskId, runEpoch, asked }]
      })
      if (targets.length === 0) break
      for (const { asked } of targets) requested.add(asked)
      cancellationResults.push(
        ...(await Promise.allSettled(
          targets.map(({ taskId, runEpoch }) =>
            context.taskManager.cancelTask(taskId, reason, {
              abort: "skip",
              ...(runEpoch === undefined ? {} : { expectedRunEpoch: runEpoch }),
            }),
          ),
        )),
      )
    }
    const cancellationFailure = cancellationResults.find((result) => result.status === "rejected")
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
    if (cancellationFailure?.status === "rejected") throw cancellationFailure.reason
  } finally {
    context.resolveCancellationCompleted()
  }
}

export async function cancelledSnapshot(context: SchedulerContext): Promise<DagRunRecordV1> {
  if (context.suspended && !context.cancellationStarted) return context.journal.snapshot()
  await context.cancellationCompleted
  return context.journal.snapshot()
}

export function whenAdmissionIdle(context: SchedulerContext): Promise<void> {
  if (!context.admissionInProgress) return Promise.resolve()
  return new Promise<void>((resolve) => context.admissionIdleWaiters.add(resolve))
}

export function resolveAdmissionIdle(context: SchedulerContext): void {
  for (const resolve of context.admissionIdleWaiters) resolve()
  context.admissionIdleWaiters.clear()
}
