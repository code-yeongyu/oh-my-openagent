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
import { releaseDagRunLease, takeDagRunLease } from "../../../../senpi-task/src/dag/run-lease"
import { createDagScheduler, type DagRunReentry } from "../../../../senpi-task/src/dag/scheduler"

export type OwnedScheduler = { readonly scheduler: DagScheduler; running?: Promise<DagRunRecordV1> }

/**
 * The schedulers this runtime runs, one per run. A run is scheduled here only when this runtime
 * already holds it or it is still `pending`: a `running` run nobody here holds belongs to whichever
 * process its lease names, and only recovery may decide (by that lease) to take it over (#15125).
 * Every scheduler run here holds the run's durable lease from before its first admission until it
 * settles or is retired, the way a recovered run holds the lease its claim wrote.
 */
export function createDagSchedulerRegistry(ports: {
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly store: DagFileStore
  readonly coreManager: DagManager
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly logger: ComponentLogger
  readonly isProcessAlive: (pid: number) => boolean
}) {
  const { schedulers, store, coreManager, schedulerOptions, logger } = ports
  const lease = { hostPid: process.pid, isProcessAlive: ports.isProcessAlive }

  const controller = (runId: DagRunId, parentSessionId: string): OwnedScheduler => {
    const existing = schedulers.get(runId)
    if (existing !== undefined) return existing
    const initialRecord = coreManager.record(runId, parentSessionId)
    const created: OwnedScheduler = { scheduler: createDagScheduler({ ...schedulerOptions, initialRecord }) }
    schedulers.set(runId, created)
    return created
  }

  const track = (runId: DagRunId, owned: OwnedScheduler, run: Promise<DagRunRecordV1>): void => {
    const running = run
      .then(async (record) => {
        await owned.scheduler.whenIdle()
        return record
      })
      .finally(() => {
        if (schedulers.get(runId) !== owned) return
        schedulers.delete(runId)
        releaseDagRunLease(store, runId, lease.hostPid)
      })
    owned.running = running
    void running.catch((error: unknown) => {
      logger.error("omo-senpi dag scheduler failed", {
        runId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  /** Returns false for a `running` run this runtime does not hold: it is recovery's to claim or leave. */
  const ensureScheduled = (runId: DagRunId, parentSessionId: string): boolean => {
    const held = schedulers.get(runId)
    if (held?.running !== undefined) return true
    const record = coreManager.record(runId, parentSessionId)
    if (held === undefined && record.status === "running") return false
    if (record.status !== "pending" && record.status !== "running") return true
    if (takeDagRunLease(store, runId, lease) === undefined) return true
    const owned = held ?? controller(runId, parentSessionId)
    track(runId, owned, owned.scheduler.run())
    return true
  }

  /**
   * The single re-entry seam for the control verbs. The settled scheduler deleted itself from
   * `schedulers` on settle, so the fresh instance the verb built must be re-registered here or the
   * next cancel/wait would silently build a THIRD scheduler over a live run.
   */
  const adoptReentry = (runId: DagRunId, reentry: DagRunReentry): void => {
    const owned: OwnedScheduler = { scheduler: reentry.scheduler }
    schedulers.set(runId, owned)
    takeDagRunLease(store, runId, lease)
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

  return { controller, ensureScheduled, adoptReentry, adoptInstalled }
}
