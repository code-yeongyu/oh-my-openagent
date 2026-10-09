import type { TaskRecord } from "./record-types"

/**
 * Whether a handle minted at `refEpoch` still names the task's current run.
 *
 * - `live`: `run_start_epoch <= refEpoch <= run_epoch`. Epoch moves inside one run (model fallback,
 *   fallback handoff, reattach) keep a handle live; a revive raises `run_start_epoch` past it.
 * - `superseded`: a revive started a newer run after the handle was minted.
 * - `legacy`: the record predates `run_start_epoch`, so only an exact epoch match is trusted and a
 *   handle from before an in-run epoch move cannot be told apart from one before a revive.
 * - `unknown`: the handle names an epoch this record never reached.
 */
export type RunFence = "live" | "superseded" | "legacy" | "unknown"

export function fenceRun(record: TaskRecord, refEpoch: number): RunFence {
  const current = record.notification.run_epoch
  if (refEpoch > current) return "unknown"
  if (record.run_start_epoch === undefined) return refEpoch === current ? "live" : "legacy"
  return refEpoch >= record.run_start_epoch ? "live" : "superseded"
}

/**
 * The epoch the next run, or the next in-run move, takes: one above every epoch this record ever issued, including one a
 * rollback took back. Epochs therefore never repeat for a task, and a ref names at most one run for its whole life.
 */
export function nextRunEpoch(record: TaskRecord): number {
  return Math.max(record.notification.run_epoch, record.burnt_epoch ?? 0) + 1
}
