import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaimAge } from "./owned-attempt"
import { outstandingStopRefusal, type DagRunStopper } from "./outstanding-stop"
import { liveRunChildren } from "./run-children-stop"
import type { DagNodeId } from "./types"

/**
 * The one gate for "may a child of this run start, be revived, be attached or be folded now?"
 * (#11381). Every such point asks it and differs only in what it does with a refusal: admission and
 * recovery fail the node closed, send and re-entry refuse the verb retryably, the self-resume fence
 * holds or retires the turn. Three rules, one function each, and nothing re-derives a subset:
 * 1. no child of the run is live outside a current claim - a superseded attempt's, a removed node's,
 *    or a refused turn whose stop is not confirmed (`staleLiveChildren`);
 * 2. a settled run owes no stop (`outstandingStopRefusal`);
 * 3. the task in hand is its node's current attempt (`ownedClaimAge`).
 */
export type StaleLiveChild = { readonly nodeId: DagNodeId; readonly taskId: string }

export function staleLiveChildren(tasks: DagRunStopper, record: DagRunRecordV1): readonly StaleLiveChild[] {
  return liveRunChildren(tasks, record).flatMap((task) =>
    task.owner === undefined || ownedClaimAge(task, record) !== "superseded"
      ? []
      : [{ nodeId: task.owner.nodeId, taskId: task.task_id }],
  )
}

export function staleLiveRefusal(stale: readonly StaleLiveChild[]): string | undefined {
  if (stale.length === 0) return undefined
  const ids = stale.map(({ taskId }) => taskId).join(", ")
  return `task ${ids} of a superseded attempt or removed node is still live and could not be stopped`
}

/** Rules 1-3 for a point that starts or revives `task` (or a fresh child when it is undefined). */
export function childStartRefusal(tasks: DagRunStopper, record: DagRunRecordV1, task?: TaskRecord): string | undefined {
  const owed = outstandingStopRefusal(tasks, record)
  if (owed !== undefined) return owed
  const stale = staleLiveRefusal(staleLiveChildren(tasks, record))
  if (stale !== undefined) return stale
  if (task === undefined || ownedClaimAge(task, record) === "current") return undefined
  return `task ${task.task_id} belongs to an earlier attempt of DAG node "${task.owner?.nodeId}", not its current one`
}

/**
 * Rule 1 for a point that is about to start children without a scheduler: stale live children are
 * asked to stop once, then re-read. Synchronous when nothing is stale, so a caller that must not yield
 * (recovery's reconcile) keeps its ordering.
 */
export function fenceStaleLiveChildren(
  tasks: DagRunStopper,
  record: DagRunRecordV1,
  reason = "superseded by the run's current definition",
): string | undefined | Promise<string | undefined> {
  const stale = staleLiveChildren(tasks, record)
  if (stale.length === 0) return undefined
  return Promise.allSettled(stale.map(({ taskId }) => tasks.cancelTask(taskId, reason))).then(() =>
    staleLiveRefusal(staleLiveChildren(tasks, record)),
  )
}
