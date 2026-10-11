import { fenceRun, type TaskRecord } from "../state"
import type { CancelOutcome, SendOutcome } from "./types"

const STALE_RUN_REASON = "the handle names an earlier run of this task"

export function runMoved(record: TaskRecord, expectedRunEpoch: number | undefined): boolean {
  return expectedRunEpoch !== undefined && fenceRun(record, expectedRunEpoch) !== "live"
}

export function staleSend(record: TaskRecord): SendOutcome {
  return { kind: "stale", task_id: record.task_id, run_epoch: record.notification.run_epoch, reason: `Task ${record.task_id}: ${STALE_RUN_REASON}.` }
}

export function staleCancel(record: TaskRecord): CancelOutcome {
  return { kind: "stale", task_id: record.task_id, status: record.status, run_epoch: record.notification.run_epoch, reason: `Task ${record.task_id}: ${STALE_RUN_REASON}.` }
}
