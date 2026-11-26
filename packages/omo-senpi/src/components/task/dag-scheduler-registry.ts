import type {
  DagFileStore,
  DagManager,
  DagRunId,
  DagRunRecordV1,
  DagScheduler,
  DagSchedulerOptions,
  InstalledDagRun,
} from "@oh-my-opencode/senpi-task/dag"

import type { ComponentLogger } from "../../extension/types"
import { acquireDagRun, type DagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { releaseDagRunLease } from "../../../../senpi-task/src/dag/run-lease"
import { createDagScheduler, type DagRunReentry } from "../../../../senpi-task/src/dag/scheduler"

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
  readonly coreManager: DagManager
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly logger: ComponentLogger
  readonly isProcessAlive: (pid: number) => boolean
  readonly reservations: DagRunReservations
}) {
  const { schedulers, store, coreManager, schedulerOptions, logger } = ports
  const lease = {
    taskManager: schedulerOptions.taskManager,
    hostPid: process.pid,
    isProcessAlive: ports.isProcessAlive,
  }

  /** "This host holds the run": a scheduler of this runtime is running it (started or installed here). */
  const holdsRun = (runId: DagRunId): boolean => schedulers.get(runId)?.running !== undefined

  const schedulerFor = (runId: DagRunId, parentSessionId: string): OwnedScheduler => ({
    scheduler: createDagScheduler({ ...schedulerOptions, initialRecord: coreManager.record(runId, parentSessionId) }),
  })
  const register = (runId: DagRunId, initialRecord: DagRunRecordV1): void => {
    const owned: OwnedScheduler = { scheduler: createDagScheduler({ ...schedulerOptions, initialRecord }) }
    schedulers.set(runId, owned)
    track(runId, owned, owned.scheduler.run())
  }

  // A verb on a run this host does not hold gets a throwaway carrier that never enters `schedulers`,
  // so a refused or non-adopting verb can never make the run read as held here.
  const controller = (runId: DagRunId, parentSessionId: string): OwnedScheduler =>
    holdsRun(runId) ? (schedulers.get(runId) as OwnedScheduler) : schedulerFor(runId, parentSessionId)

  const track = (runId: DagRunId, owned: OwnedScheduler, run: Promise<DagRunRecordV1>): void => {
    const running = run
      .then(async (record) => {
        await owned.scheduler.whenIdle()
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
      logger.error("omo-senpi dag scheduler failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
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
      eligible: (fresh) => fresh.status === "pending" && fresh.parentSessionId === parentSessionId,
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

  return { holdsRun, controller, ensureScheduled, adoptReentry, adoptInstalled }
}
