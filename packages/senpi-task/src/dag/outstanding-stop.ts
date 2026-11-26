import type { TaskManager } from "../manager/types"
import { ownedClaims } from "../manager/owned-claims"
import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { liveRunChildren, stopRunChildren } from "./run-children-stop"
import { TERMINAL_DAG_RUN_STATUSES, type DagRunSnapshot } from "./types"

export type DagOwnedTaskReader = Pick<TaskManager, "findOwnedTasks" | "selfResumeStopPending">
export type DagRunStopper = Pick<TaskManager, "findOwnedTasks" | "cancelTask" | "selfResumeStopPending">
export type DagOutstandingStop = NonNullable<DagRunSnapshot["outstandingStop"]>

/**
 * The one derivation of a settled run's stop obligation (#11381): a run owes a stop exactly while it
 * is terminal and still owns a live child. Nothing new is stored; both halves are durable (the run
 * checkpoint and the task records), so a fresh manager after a restart reads the same answer. Every
 * surface - snapshot, wait, amend and re-entry - asks here, and a repeated cancel is what clears it.
 */
export function outstandingRunStop(
  tasks: DagOwnedTaskReader | undefined,
  record: Pick<DagRunRecordV1, "runId" | "status">,
): DagOutstandingStop | undefined {
  if (tasks === undefined || !TERMINAL_DAG_RUN_STATUSES.has(record.status)) return undefined
  const liveTaskIds = liveRunChildren(tasks, record).map((task) => task.task_id)
  return liveTaskIds.length === 0 ? undefined : { liveTaskIds }
}

export function withOutstandingStop(
  snapshot: DagRunSnapshot,
  tasks: DagOwnedTaskReader | undefined,
  record: DagRunRecordV1,
): DagRunSnapshot {
  const outstandingStop = outstandingRunStop(tasks, record)
  return outstandingStop === undefined ? snapshot : { ...snapshot, outstandingStop }
}

/**
 * Why a settled run with an outstanding stop refuses re-entry, or undefined when it does not owe one.
 * `except` leaves out the task a verb acts on itself: a send to that very child starts nothing beside it.
 */
export function outstandingStopRefusal(
  tasks: DagOwnedTaskReader | undefined,
  record: DagRunRecordV1,
  except?: string,
): string | undefined {
  const live = outstandingRunStop(tasks, record)?.liveTaskIds.filter((taskId) => taskId !== except) ?? []
  if (live.length === 0) return undefined
  return `dag run "${record.runId}" is ${record.status} but its children ${live.join(", ")} are still live; cancel the run again to finish stopping them`
}

/**
 * Amendment finishes a settled run's owed stop before it changes anything: a drain that leaves a child
 * live is not an error here, because the amendment's own check then refuses with run_still_active.
 */
export async function drainOutstandingStop(tasks: DagRunStopper | undefined, record: DagRunRecordV1): Promise<void> {
  if (tasks === undefined) return
  await stopRunChildren(tasks, record, new Set(), "the run is being amended")
}

/**
 * Reads the DAG-owned task records once per synchronous batch - a run list plus every snapshot drawn
 * from it on one repaint - instead of once per run: the derivation stays the one above, its input is
 * shared. The next batch reads afresh, so a debt that changes only in the task store is never stale.
 */
export function batchedOwnedTaskReader(tasks: DagOwnedTaskReader): DagOwnedTaskReader {
  let batch: readonly TaskRecord[] | undefined
  return {
    findOwnedTasks: (scope) => {
      if (batch === undefined) {
        batch = tasks.findOwnedTasks({ kind: "dag" })
        queueMicrotask(() => {
          batch = undefined
        })
      }
      return ownedClaims(batch, scope)
    },
    selfResumeStopPending: (taskId) => tasks.selfResumeStopPending?.(taskId) === true,
  }
}
