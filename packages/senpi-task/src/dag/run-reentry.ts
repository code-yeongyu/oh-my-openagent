// Run re-entry: handing a settled or idle run to a NEW scheduler instance, owned (lease and
// reservation) before its first write (#15125).
import { dagRunResumedEvent } from "./events"
import type { DagRunRecordV1 } from "./manager"
import { acquireReentryLease, controlJournal, DagNodeControlError, readRecord } from "./node-control-context"
import { createDagScheduler, type DagScheduler, type DagSchedulerOptions } from "./scheduler"
import { TERMINAL_DAG_RUN_STATUSES } from "./types"

export type DagRunReentry = {
  /** The record as it stands after the control verb journaled its mutations, before waves re-run. */
  readonly record: DagRunRecordV1
  readonly scheduler: DagScheduler
  readonly run: Promise<DagRunRecordV1>
}

/**
 * Re-enters a settled or idle run with a FRESH scheduler built from the CURRENT record. The settled
 * instance is never resumed: its cancellation deferreds and admission latches are single-shot, so a
 * second run on it would inherit a spent state machine. `dag.run.resumed` is journaled
 * SYNCHRONOUSLY here, before the run promise exists, so a caller that waits immediately after a
 * retry blocks on the NEW settle instead of short-circuiting on the stale terminal checkpoint.
 *
 * `preAttachedTasks` is deliberately dropped: it describes children that were live when the PREVIOUS
 * instance was built, and re-attaching an already-settled task would fold its outcome onto the node
 * a second time.
 *
 * Reviving a settled run makes it active again, so it must fit under the session's active-run cap
 * (`task.dag.max_runs_per_session`); a refusal throws before anything is journaled.
 */
export function reenterDagRun(options: DagSchedulerOptions): DagRunReentry {
  const observed = readRecord(options.store, options.initialRecord.runId) ?? options.initialRecord
  // A fast refusal only: the acquisition decides it again on the fresh record.
  if (observed.pause?.reason === "user_stop") {
    throw new DagNodeControlError({
      code: "run_paused_by_user",
      message: "only the user's Resume may restart this run",
      runId: observed.runId,
    })
  }
  const { record, abandon } = acquireReentryLease(options, observed.runId)
  try {
    return startReentry(
      options,
      withRevivalCapacity(options, record, () => resumeIfSettled(options, record)),
    )
  } catch (error) {
    abandon()
    throw error
  }
}

// A settled run counts against the cap again the moment it resumes, so the journal writes that revive
// it run under the session capacity lock: a concurrent start or revival cannot take the same slot, and
// a refusal throws before anything is journaled. The scheduler starts after the lock is released.
export function withRevivalCapacity<T>(options: DagSchedulerOptions, record: DagRunRecordV1, operation: () => T): T {
  if (!TERMINAL_DAG_RUN_STATUSES.has(record.status)) return operation()
  return options.store.withSessionRunCapacity(record.parentSessionId, record.runId, operation)
}

export function resumeIfSettled(options: DagSchedulerOptions, current: DagRunRecordV1): DagRunRecordV1 {
  if (!TERMINAL_DAG_RUN_STATUSES.has(current.status)) return current
  const journal = controlJournal(options, current)
  journal.append(dagRunResumedEvent({ generation: current.generation + 1 }))
  return journal.snapshot()
}

export function startReentry(options: DagSchedulerOptions, record: DagRunRecordV1): DagRunReentry {
  const { preAttachedTasks: _preAttachedTasks, ...reentryOptions } = options
  const scheduler = createDagScheduler({ ...reentryOptions, initialRecord: record })
  return { record, scheduler, run: scheduler.run() }
}
