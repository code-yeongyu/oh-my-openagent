import { transitionTaskRecord, type TaskRecord, type TaskTransitionAudit } from "../state"
import type { TaskRecordStore } from "../store"
import { isTerminalRecord } from "./manager-helpers"

export type LaunchRun = {
  readonly taskId: string
  readonly epoch: number
  readonly owner: number | undefined
}

export function launchRunOf(record: TaskRecord): LaunchRun {
  return { taskId: record.task_id, epoch: record.notification.run_epoch, owner: record.host_pid }
}

function isSameRun(run: LaunchRun, fresh: TaskRecord): boolean {
  return fresh.notification.run_epoch === run.epoch && fresh.host_pid === run.owner
}

export function ownsRun(run: LaunchRun, fresh: TaskRecord | null | undefined): fresh is TaskRecord {
  return fresh != null && fresh.status === "running" && isSameRun(run, fresh)
}

/**
 * Fail a launch's task only while that launch's run still holds the record, in one locked write: a
 * cancel, an interrupt or another owner that moved the task meanwhile keeps its own outcome, and a
 * stale attempt never terminalizes a newer run. Returns whether the failure was applied.
 */
export type OwnedRunFailure = {
  readonly errorMessage: string
  readonly failureKind?: TaskRecord["failure_kind"]
  readonly failureReason?: TaskRecord["failure_reason"]
}

export function failOwnedRun(store: TaskRecordStore, run: LaunchRun, timestamp: string, failure: OwnedRunFailure): boolean {
  let audit: TaskTransitionAudit | undefined
  let applied = false
  store.mutate(run.taskId, (fresh) => {
    if (!isSameRun(run, fresh) || isTerminalRecord(fresh)) return fresh
    const result = transitionTaskRecord(fresh, {
      type: "fail",
      timestamp,
      error_message: failure.errorMessage,
      ...(failure.failureKind === undefined ? {} : { failure_kind: failure.failureKind }),
      ...(failure.failureReason === undefined ? {} : { failure_reason: failure.failureReason }),
    })
    audit = result.audit
    applied = result.applied
    return result.applied ? result.record : fresh
  })
  if (audit !== undefined) store.appendEvent(run.taskId, { type: audit.type, payload: audit })
  return applied
}
