import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { ownedClaimAge } from "./owned-attempt"
import { outstandingStopRefusal, type DagRunStopper } from "./outstanding-stop"
import { liveRunChildren } from "./run-children-stop"
import type { DagNodeId } from "./types"

/**
 * The one gate for "may a child of this run start, be revived, be attached or be folded now?"
 * (#11381): three rules, one function each, and every point calls them rather than re-deriving a
 * subset. Points differ only in what they do with a refusal.
 * 1. No child of the run is live outside a current claim: a superseded attempt's, a removed node's,
 *    or a refused turn whose stop is not confirmed (`staleLiveChildren`, liveness by `isLiveOwnedTask`).
 *    Admission and the re-entry sweep stop such a child and fail the ready nodes; recovery stops it and
 *    fails every start; send refuses. Retry and amend leave it to the re-entered scheduler's fence.
 * 2. A settled run owes no stop (`outstandingStopRefusal`). Send, retry and every re-entry refuse; amend
 *    drains first; snapshot, wait, attach and list report it.
 * 3. The task in hand is its node's current attempt (`ownedClaimAge`). Admission adopts only the
 *    current claim, recovery never folds or attaches another, send refuses, and the self-resume fence
 *    retires anything else. The manager's owned start is the same rule's process-local fence: it never
 *    starts or reuses beside another live claim (`RefusedStops.isLive`).
 * One gate object would not fit: admission and recovery act on a whole pass, send on one task, and the
 * self-resume fence answers inside a record mutation that must not read beyond the run's checkpoint.
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

export type ChildGateRefusal = {
  readonly rule: "stop_owed" | "stale_live" | "not_current"
  readonly message: string
}

/**
 * Rules 1-3 for a point that starts or revives `task` (or a fresh child when it is undefined). The task
 * in hand is left out of rules 1-2: acting on that very child starts nothing beside it, and its own
 * unconfirmed stop is the manager's to await before it is revived.
 */
export function childStartRefusal(
  tasks: DagRunStopper,
  record: DagRunRecordV1,
  task?: TaskRecord,
): ChildGateRefusal | undefined {
  const owed = outstandingStopRefusal(tasks, record, task?.task_id)
  if (owed !== undefined) return { rule: "stop_owed", message: owed }
  const stale = staleLiveRefusal(staleLiveChildren(tasks, record).filter(({ taskId }) => taskId !== task?.task_id))
  if (stale !== undefined) return { rule: "stale_live", message: stale }
  if (task === undefined || ownedClaimAge(task, record) === "current") return undefined
  const message = `task ${task.task_id} belongs to an earlier attempt of DAG node "${task.owner?.nodeId}", not its current one`
  return { rule: "not_current", message }
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
