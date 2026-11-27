import type { DagFileStore, DagRunId, DagRunRecordV1, DagSchedulerOptions } from "@oh-my-opencode/senpi-task/dag"

import { DagNodeControlError } from "../../../../senpi-task/src/dag/node-control-context"
import {
  acquireDagRun,
  dagRunEligibility,
  reserveWhenFree,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import { observeChildOwners, type DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import { createDagScheduler } from "../../../../senpi-task/src/dag/scheduler"
import { TERMINAL_DAG_RUN_STATUSES } from "../../../../senpi-task/src/dag/types"
import type { OwnedScheduler } from "./dag-scheduler-registry"

/**
 * Cancel is routed, never refused and never lost (#15125). It waits for any operation of this
 * process still installing, re-entering or mutating the run, then cancels through the scheduler that
 * holds the run by then, or (no scheduler here) acquires the run like every other entry and cancels
 * through a scheduler built from the acquired record and retired right after. Either way the
 * scheduler's cancel is the ONE run-wide drain (`stopRunChildren`, #11381): an unsettled run's whole
 * live owned set (paused children of a parked or user-stopped run included) is stopped before the run
 * is journaled cancelled; a settled run (a failed run with a revived node, or one owing a stop) is only
 * drained and keeps its status. The cancel never awaits a revive fold: the fold waits for this
 * reservation, the cancel only for the stops it issued.
 * Resolves with the record it cancelled, or undefined when the run was already terminal.
 */
export function createDagRunCancel(ports: {
  readonly store: DagFileStore
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly schedulers: ReadonlyMap<DagRunId, OwnedScheduler>
  readonly reservations: DagRunReservations
  readonly holders: DagRunHolderProbe
  holdsRun(runId: DagRunId): boolean
}) {
  return async (runId: DagRunId, parentSessionId: string, reason?: string): Promise<DagRunRecordV1 | undefined> => {
    const reservation = await reserveWhenFree(ports.reservations, runId, "cancel")
    try {
      const held = ports.holdsRun(runId) ? ports.schedulers.get(runId) : undefined
      if (held !== undefined) {
        const record = held.scheduler.snapshot()
        await held.scheduler.cancel(runId, reason)
        return record
      }
      const observing = observeChildOwners(ports.holders, ports.store.readCheckpoint<DagRunRecordV1>(runId))
      if (observing !== undefined) await observing
      const acquired = acquireDagRun<DagRunRecordV1>(ports.store, runId, {
        operation: "cancel",
        probe: ports.holders,
        reservation,
        eligible: dagRunEligibility.unheldCancel(parentSessionId),
        // A settled run is only drained: its lease, if any, is a revive's, and leaves in that revive's fold.
        leaseWhen: (fresh) => !TERMINAL_DAG_RUN_STATUSES.has(fresh.status),
      })
      if (acquired.kind === "held") {
        throw new DagNodeControlError({
          code: "run_not_owned",
          message: `dag run "${runId}" is held by live process ${acquired.holderPid}`,
          runId,
        })
      }
      if (acquired.kind !== "acquired") return undefined
      const scheduler = createDagScheduler({ ...ports.schedulerOptions, initialRecord: acquired.record })
      try {
        await scheduler.cancel(runId, reason)
      } finally {
        await scheduler.suspend()
      }
      return TERMINAL_DAG_RUN_STATUSES.has(acquired.record.status) ? undefined : acquired.record
    } finally {
      reservation.release()
    }
  }
}
