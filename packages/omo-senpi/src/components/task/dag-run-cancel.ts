import type { DagFileStore, DagRunId, DagRunRecordV1, DagSchedulerOptions } from "@oh-my-opencode/senpi-task/dag"

import { DagNodeControlError } from "../../../../senpi-task/src/dag/node-control-context"
import {
  acquireDagRun,
  dagRunEligibility,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import type { DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import { createDagScheduler } from "../../../../senpi-task/src/dag/scheduler"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import { endPausedRunChildren, type PausedNodeHoldPort } from "./dag-paused-cancel"
import type { OwnedScheduler } from "./dag-scheduler-registry"

/**
 * Cancel is routed, never refused and never lost (#15125). It waits for any operation of this
 * process still installing, re-entering or mutating the run, then cancels through the scheduler that
 * holds the run by then, or (no scheduler here) acquires the run like every other entry and ends its
 * nodes' children before journaling the cancellation through a scheduler retired right after.
 * Resolves with the record it cancelled, or undefined when the run was already terminal.
 */
export function createDagRunCancel(ports: {
  readonly store: DagFileStore
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly schedulers: ReadonlyMap<DagRunId, OwnedScheduler>
  readonly reservations: DagRunReservations
  readonly holders: DagRunHolderProbe
  readonly children: Pick<TaskManager, "get" | "getResidentHandle" | "findOwnedTask" | "cancelTask">
  readonly closure: PausedNodeHoldPort
  holdsRun(runId: DagRunId): boolean
}) {
  const reserveWhenFree = async (runId: DagRunId) => {
    for (;;) {
      const reservation = ports.reservations.reserve(runId, "cancel")
      if (reservation !== undefined) return reservation
      await ports.reservations.whenFree(runId)
    }
  }

  return async (runId: DagRunId, parentSessionId: string, reason?: string): Promise<DagRunRecordV1 | undefined> => {
    const reservation = await reserveWhenFree(runId)
    try {
      const held = ports.holdsRun(runId) ? ports.schedulers.get(runId) : undefined
      if (held !== undefined) {
        const record = held.scheduler.snapshot()
        await held.scheduler.cancel(runId, reason)
        return record
      }
      const acquired = acquireDagRun<DagRunRecordV1>(ports.store, runId, {
        operation: "cancel",
        probe: ports.holders,
        reservation,
        eligible: dagRunEligibility.unheldCancel(parentSessionId),
      })
      if (acquired.kind === "held") {
        throw new DagNodeControlError({
          code: "run_not_owned",
          message: `dag run "${runId}" is held by live process ${acquired.holderPid}`,
          runId,
        })
      }
      if (acquired.kind !== "acquired") return undefined
      await endPausedRunChildren(ports.children, acquired.record, ports.closure)
      const scheduler = createDagScheduler({ ...ports.schedulerOptions, initialRecord: acquired.record })
      try {
        await scheduler.cancel(runId, reason)
      } finally {
        await scheduler.suspend()
      }
      return acquired.record
    } finally {
      reservation.release()
    }
  }
}
