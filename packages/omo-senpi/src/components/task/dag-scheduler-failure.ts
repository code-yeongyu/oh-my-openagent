import type { DagRunId, DagSchedulerOptions } from "@oh-my-opencode/senpi-task/dag"

import {
  DAG_SCHEDULER_FAILED_PAUSE_REASON,
  dagNodeTransitionedEvent,
  dagRunPausedEvent,
} from "../../../../senpi-task/src/dag/events"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import {
  acquireDagRun,
  dagRunEligibility,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import type { DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { liveRunChildren, stopRunChildren } from "../../../../senpi-task/src/dag/run-children-stop"
import type { ComponentLogger } from "../../extension/types"

/**
 * What this runtime does when one of its schedulers ends with an error instead of settling its run
 * (#15125). The run is left `running` with no scheduler here, so it is handed to recovery at once:
 * recovery claims a `running` run no scheduler here holds (the one acquisition, the shared
 * reservation) and follows its live children again. A second consecutive failure of the same run is
 * not handed back (a fault that keeps recurring would loop). It is parked through the same acquisition,
 * holding the run's reservation: every live child the run owns is stopped through the one run-wide
 * drain (`stopRunChildren`, #11381; two schedulers in a row could not follow them), each active node
 * whose children all stopped fails with the real error, and the run is paused `scheduler_failed` (the
 * pause write drops the lease). A node whose child did not stop is not failed as if it had: it stays
 * active and the survivors are logged, so a later cancel or recovery follows that live child. The park leaves no active node, so the bound is durable: a later
 * automatic recovery re-admits nothing and settles the run `failed`; only retry or amend runs it again.
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
  const park = async (runId: DagRunId, parentSessionId: string, error: string): Promise<void> => {
    const acquired = acquireDagRun<DagRunRecordV1>(ports.schedulerOptions.store, runId, {
      operation: "park after scheduler failure",
      probe: ports.probe,
      reservations: ports.reservations,
      eligible: dagRunEligibility.parkFailed(parentSessionId, () => ports.holdsRun(runId)),
    })
    if (acquired.kind !== "acquired") return
    try {
      const tasks = ports.schedulerOptions.taskManager
      const failure = await stopRunChildren(tasks, acquired.record, new Set(), "the run's scheduler failed again")
      const surviving = liveRunChildren(tasks, acquired.record)
      const survives = (nodeId: string, taskId: string | undefined): boolean =>
        surviving.some((task) => task.owner?.nodeId === nodeId || task.task_id === taskId)
      const at = new Date().toISOString()
      const message = `the run's scheduler failed again in this session: ${error}`
      const active = acquired.record.nodes.filter(
        (node) => (node.state === "scheduled" || node.state === "running") && !survives(node.id, node.taskId),
      )
      const errors = new Map(
        active.map((node) => [node.id, { code: "task_cancelled" as const, message, nodeId: node.id, at }]),
      )
      const journal = controlJournal(
        { ...ports.schedulerOptions, initialRecord: acquired.record },
        acquired.record,
        errors,
      )
      for (const node of active)
        journal.append(
          dagNodeTransitionedEvent({ nodeId: node.id, from: node.state, to: "failed", reason: { kind: "failed" } }),
        )
      journal.append(dagRunPausedEvent({ reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }))
      ports.logger.warn("omo-senpi dag run parked after its scheduler failed again", { runId, error })
      if (failure !== undefined)
        ports.logger.error("omo-senpi dag run parked with children that did not stop; their nodes stay active", {
          runId,
          survivors: surviving.map((task) => task.task_id),
        })
    } finally {
      acquired.reservation?.release()
    }
  }
  return {
    settled: (runId: DagRunId): void => {
      failures.delete(runId)
    },
    failed: async (runId: DagRunId, parentSessionId: string, error: string): Promise<void> => {
      const count = (failures.get(runId) ?? 0) + 1
      failures.set(runId, count)
      try {
        if (count === 1) await ports.recover(parentSessionId)
        else await park(runId, parentSessionId, error)
      } catch (error) {
        ports.logger.error("omo-senpi dag run could not be handed on after its scheduler failed", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
