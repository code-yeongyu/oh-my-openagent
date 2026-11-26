import type { DagRunId, DagSchedulerOptions } from "@oh-my-opencode/senpi-task/dag"

import { dagRunPausedEvent } from "../../../../senpi-task/src/dag/events"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import {
  acquireDagRun,
  dagRunEligibility,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import type { DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import type { ComponentLogger } from "../../extension/types"

export const DAG_SCHEDULER_FAILED_PAUSE_REASON = "scheduler_failed"

/**
 * What this runtime does when one of its schedulers ends with an error instead of settling its run
 * (#15125). The run is left `running` with no scheduler here, so it is handed to recovery at once:
 * recovery claims a `running` run no scheduler here holds (the one acquisition, the shared
 * reservation) and follows its live children again. A second consecutive failure of the same run is
 * not handed back (a fault that keeps recurring would loop): the run is parked as paused
 * (`scheduler_failed`) through the same acquisition, so cancel and the next session start take it.
 */
export function createSchedulerFailureHandler(ports: {
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly reservations: DagRunReservations
  readonly probe: DagRunHolderProbe
  readonly logger: ComponentLogger
  holdsRun(runId: DagRunId): boolean
  recover(sessionId: string): Promise<void>
}) {
  const failures = new Map<DagRunId, number>()
  const park = (runId: DagRunId, parentSessionId: string): void => {
    const acquired = acquireDagRun<DagRunRecordV1>(ports.schedulerOptions.store, runId, {
      operation: "park after scheduler failure",
      probe: ports.probe,
      reservations: ports.reservations,
      eligible: dagRunEligibility.parkFailed(parentSessionId, () => ports.holdsRun(runId)),
    })
    if (acquired.kind !== "acquired") return
    try {
      controlJournal({ ...ports.schedulerOptions, initialRecord: acquired.record }, acquired.record).append(
        dagRunPausedEvent({ reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }),
      )
    } finally {
      acquired.reservation?.release()
    }
  }
  return {
    settled: (runId: DagRunId): void => {
      failures.delete(runId)
    },
    failed: async (runId: DagRunId, parentSessionId: string): Promise<void> => {
      const count = (failures.get(runId) ?? 0) + 1
      failures.set(runId, count)
      try {
        if (count === 1) await ports.recover(parentSessionId)
        else park(runId, parentSessionId)
      } catch (error) {
        ports.logger.error("omo-senpi dag run could not be handed on after its scheduler failed", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
