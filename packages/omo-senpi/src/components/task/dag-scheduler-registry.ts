import type {
  DagFileStore,
  DagRecoveryOutcome,
  DagRunId,
  DagRunRecordV1,
  DagScheduler,
  DagSchedulerOptions,
  InstalledDagRun,
} from "@oh-my-opencode/senpi-task/dag"

import type { ComponentLogger } from "../../extension/types"
import {
  acquireDagRun,
  dagRunEligibility,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import { releaseDagRunLease } from "../../../../senpi-task/src/dag/run-lease"
import { createDagScheduler, type DagRunReentry } from "../../../../senpi-task/src/dag/scheduler"
import type { PausedNodeHoldPort } from "./dag-paused-cancel"
import { createSchedulerFailureHandler } from "./dag-scheduler-failure"

export type OwnedScheduler = { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> }

/**
 * The schedulers this runtime runs, one per run. A run is scheduled here only when this runtime
 * already holds it or it is still `pending`: a `running` run nobody here holds belongs to whichever
 * process its lease names, and only recovery may decide (by that lease) to take it over (#15125).
 * Every scheduler run here holds the run's durable lease from before its first admission until the
 * write that ends its holding, the way a recovered run holds the lease its claim wrote.
 */
export function createDagSchedulerRegistry(ports: {
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly store: DagFileStore
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly logger: ComponentLogger
  readonly isProcessAlive: (pid: number) => boolean
  readonly reservations: DagRunReservations
  // Re-runs this session's recovery: a run whose scheduler here failed is handed to it.
  recover(sessionId: string): Promise<readonly DagRecoveryOutcome[]>
  // Confirms a parked run's stopped children closed their holds (bookkeeping on the one drain's result).
  readonly closure: PausedNodeHoldPort
}) {
  const { schedulers, store, schedulerOptions, logger } = ports
  const lease = {
    taskManager: schedulerOptions.taskManager,
    hostPid: process.pid,
    isProcessAlive: ports.isProcessAlive,
  }

  /** "This host holds the run": a scheduler of this runtime is running it (started or installed here). */
  const holdsRun = (runId: DagRunId): boolean => schedulers.get(runId)?.running !== undefined
  const onSchedulerEnded = createSchedulerFailureHandler({
    schedulerOptions,
    reservations: ports.reservations,
    probe: lease,
    logger,
    holdsRun,
    children: schedulerOptions.taskManager,
    closure: ports.closure,
    recover: (sessionId) => ports.recover(sessionId),
  })

  const register = (runId: DagRunId, initialRecord: DagRunRecordV1): void => {
    const owned: OwnedScheduler = { scheduler: createDagScheduler({ ...schedulerOptions, initialRecord }) }
    schedulers.set(runId, owned)
    track(runId, owned, owned.scheduler.run())
  }

  const track = (runId: DagRunId, owned: OwnedScheduler, run: Promise<DagRunRecordV1>): void => {
    const running = run
      .then(async (record) => {
        await owned.scheduler.whenIdle()
        onSchedulerEnded.settled(runId)
        return record
      })
      .finally(() => {
        if (schedulers.get(runId) === owned) schedulers.delete(runId)
      })
    owned.running = running
    void running.catch((error: unknown) => {
      // A scheduler that failed holds nothing any more; a settled or retired one leaves its lease to
      // the write that ends its holding (terminal, park, Stop, or the shutdown pause).
      releaseDagRunLease(store, runId, lease.hostPid)
      const message = error instanceof Error ? error.message : String(error)
      logger.error("omo-senpi dag scheduler failed", { runId, error: message })
      // The run is left `running` with nothing driving it: hand it on (recovery, or park) at once.
      void onSchedulerEnded.failed(runId, owned.scheduler.snapshot().parentSessionId, message)
    })
  }

  /** Returns false for a `running` run this runtime does not hold: it is recovery's to claim or leave. */
  const ensureScheduled = (runId: DagRunId, parentSessionId: string): boolean => {
    if (holdsRun(runId)) return true
    // A fresh start expects the run still `pending` and still this session's on the record it acquires;
    // anything else (finished, cancelled, parked by another host meanwhile) launches nothing.
    const acquired = acquireDagRun<DagRunRecordV1>(store, runId, {
      operation: "start",
      probe: lease,
      reservations: ports.reservations,
      eligible: dagRunEligibility.freshStart(parentSessionId),
    })
    if (acquired.kind !== "acquired") return !(acquired.kind === "not_eligible" && acquired.record.status === "running")
    try {
      register(runId, acquired.record)
    } finally {
      acquired.reservation?.release()
    }
    return true
  }

  /**
   * The single re-entry seam for the control verbs. The settled scheduler deleted itself from
   * `schedulers` on settle, so the fresh instance the verb built must be re-registered here or the
   * next cancel/wait would silently build a THIRD scheduler over a live run. Ownership is decided
   * before this: the re-entry took the run's lease ahead of its first write.
   */
  const adoptReentry = (runId: DagRunId, reentry: DagRunReentry): void => {
    const owned: OwnedScheduler = { scheduler: reentry.scheduler }
    schedulers.set(runId, owned)
    track(runId, owned, reentry.run)
  }

  // A run recovery installed keeps running in its own scheduler: register it like any re-entry so
  // `ensureScheduled` and `isRunHeldInProcess` see it instead of starting a second scheduler.
  const adoptInstalled = (installed: InstalledDagRun): void => {
    const record = store.readCheckpoint<DagRunRecordV1>(installed.runId)
    if (record === null) throw new Error("installed DAG checkpoint is missing")
    // The claim's reservation ends only now that this runtime holds the installed scheduler.
    try {
      adoptInstalledRun(installed, record)
    } finally {
      installed.release()
    }
  }
  const adoptInstalledRun = (installed: InstalledDagRun, record: DagRunRecordV1): void => {
    adoptReentry(installed.runId, {
      scheduler: installed.scheduler,
      record,
      run: installed.settled.then((outcome) => {
        if (outcome.kind !== "resumed" || outcome.record === undefined)
          throw new Error(`installed DAG ended without a resumed outcome: ${outcome.kind}`)
        return outcome.record
      }),
    })
  }

  return { holdsRun, ensureScheduled, adoptReentry, adoptInstalled }
}
