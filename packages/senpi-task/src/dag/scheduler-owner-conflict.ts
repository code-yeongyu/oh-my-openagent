import type { TaskRecord } from "../state"
import { ownedClaimAge, type OwnedClaimAge } from "./owned-attempt"
import type { OwnedStartResult } from "./owner"
import { errorMessage, failNode, isLiveTask, liveOwnedTasks, type SchedulerContext } from "./scheduler-context"
import { attachStarted } from "./scheduler-task-attachment"
import type { DagNodeId } from "./types"

type OwnerConflict = Extract<OwnedStartResult, { readonly kind: "owner_conflict" }>
export type SupersededStop = { readonly nodeId: DagNodeId; readonly result: PromiseSettledResult<unknown> }

function liveClaims(context: SchedulerContext, nodeId: DagNodeId, age: OwnedClaimAge): readonly TaskRecord[] {
  const record = context.journal.snapshot()
  return liveOwnedTasks(context, nodeId).filter((task) => ownedClaimAge(task, record) === age)
}

export async function stopSupersededClaims(
  context: SchedulerContext,
  nodeIds: readonly DagNodeId[],
): Promise<ReadonlyMap<string, SupersededStop>> {
  const stale = nodeIds.flatMap((nodeId) =>
    liveClaims(context, nodeId, "superseded").map((task) => ({ nodeId, taskId: task.task_id })),
  )
  const results = await Promise.allSettled(
    stale.map(({ taskId }) => context.taskManager.cancelTask(taskId, "superseded by a newer attempt of its DAG node")),
  )
  return new Map(
    stale.flatMap(({ nodeId, taskId }, index) => {
      const result = results[index]
      return result === undefined ? [] : [[taskId, { nodeId, result }] as const]
    }),
  )
}

/**
 * The manager refuses to start while another live claim of the node exists; which claim that is
 * decides here, by the classifier the re-entry sweep and recovery share (#11381). An earlier
 * attempt's child is never adopted: the node fails with the retryable `stale_attempt_alive`, whether
 * the stop landed or not. A current child - a same-attempt duplicate controller (#7412) or a legacy
 * owner positively identified as this attempt - is adopted. A newer attempt's child is left alone.
 */
export function settleOwnerConflict(
  context: SchedulerContext,
  nodeId: DagNodeId,
  conflict: OwnerConflict,
  stops: ReadonlyMap<string, SupersededStop>,
): void {
  const alive = liveClaims(context, nodeId, "superseded")
  if (alive.length > 0) {
    const causes = alive.map((task) => {
      const stop = stops.get(task.task_id)?.result
      return stop?.status === "rejected" ? `${task.task_id}: ${errorMessage(stop.reason)}` : task.task_id
    })
    const message = `task ${causes.join(", ")} of a superseded attempt is still live and could not be stopped`
    failNode(context, nodeId, "stale_attempt_alive", message)
    return
  }
  // The newest claim of this attempt, settled or live: once no stale one is live, its outcome is ours.
  const record = context.journal.snapshot()
  const current = context.taskManager
    .findOwnedTasks({ kind: "dag", runId: record.runId, nodeId })
    .findLast((task) => ownedClaimAge(task, record) === "current")
  if (current !== undefined) {
    const status = isLiveTask(current) ? "running" : current.status
    attachStarted(context, nodeId, {
      kind: "started",
      reused: true,
      task_id: current.task_id,
      status,
      name: current.task_id,
    })
    return
  }
  const stopped = [...stops].filter(([, stop]) => stop.nodeId === nodeId).map(([taskId]) => taskId)
  if (stopped.length > 0) {
    const message = `task ${stopped.join(", ")} of a superseded attempt was live at admission and has been stopped`
    failNode(context, nodeId, "stale_attempt_alive", message)
    return
  }
  const newer = liveClaims(context, nodeId, "newer").at(-1)
  const message =
    newer === undefined
      ? `DAG task owner conflicts with existing task ${conflict.task_id}`
      : `DAG task owner conflicts with task ${newer.task_id} of a newer attempt`
  failNode(context, nodeId, "start_failed", message)
}
