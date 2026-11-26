import type { DagRecoveryOutcome, DagRunId, DagSchedulerOptions } from "@oh-my-opencode/senpi-task/dag"

import {
  DAG_SCHEDULER_FAILED_PAUSE_REASON,
  dagNodeTransitionedEvent,
  dagRunPausedEvent,
} from "../../../../senpi-task/src/dag/events"
import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import {
  acquireDagRun,
  dagRunEligibility,
  type DagRunReservations,
} from "../../../../senpi-task/src/dag/run-acquisition"
import { releaseDagRunLease, type DagRunHolderProbe } from "../../../../senpi-task/src/dag/run-lease"
import type { DagNodeId } from "../../../../senpi-task/src/dag/types"
import type { ComponentLogger } from "../../extension/types"
import { endPausedRunChildren, type PausedNodeHoldPort } from "./dag-paused-cancel"

/**
 * What this runtime does when one of its schedulers ends with an error instead of settling its run
 * (#15125). Both branches first wait until no other operation of this process holds the run's
 * reservation, then decide on the fresh record; a run no longer `running` (cancelled, settled, parked,
 * re-entered) has nothing to hand on. First failure: hand the run to recovery, whose claim
 * (`automaticRecovery`) follows its live children again. A repeated failure of the same sequence is not
 * handed back (a recurring fault would loop): the run is parked through the one acquisition, holding
 * its reservation: live children are stopped (one that will not close is reported, never counted as
 * ended), each active node fails with the real error, and the run is paused `scheduler_failed`, the
 * write that drops the lease. A park that throws after its acquisition unwinds the lease it wrote.
 */
export function createSchedulerFailureHandler(ports: {
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly reservations: DagRunReservations
  readonly probe: DagRunHolderProbe
  readonly logger: ComponentLogger
  readonly children: Parameters<typeof endPausedRunChildren>[0]
  readonly closure: PausedNodeHoldPort
  holdsRun(runId: DagRunId): boolean
  // This session's recovery sweep; it answers for each of the session's runs (none while closed).
  recover(sessionId: string): Promise<readonly DagRecoveryOutcome[]>
}) {
  const { store } = ports.schedulerOptions
  // One count per uninterrupted sequence of this process's schedulers for a run: it lives only while a
  // hand-off is in progress or the scheduler it produced holds the run, and is cleared by the park, by
  // the run settling, and by any hand-off that ends with no scheduler of this process holding the run.
  const failures = new Map<DagRunId, number>()

  const park = async (runId: DagRunId, parentSessionId: string, error: string): Promise<"done" | "busy"> => {
    const acquired = acquireDagRun<DagRunRecordV1>(store, runId, {
      operation: "park after scheduler failure",
      probe: ports.probe,
      reservations: ports.reservations,
      eligible: dagRunEligibility.parkFailed(parentSessionId, () => ports.holdsRun(runId)),
    })
    switch (acquired.kind) {
      case "busy":
        return "busy"
      case "held":
        ports.logger.info("omo-senpi dag run not parked: another live process holds it", {
          runId,
          holderPid: acquired.holderPid,
        })
        return "done"
      case "not_eligible":
        ports.logger.info("omo-senpi dag run not parked: it is no longer running unheld here", {
          runId,
          status: acquired.record.status,
        })
        return "done"
      case "missing":
        ports.logger.warn("omo-senpi dag run not parked: its checkpoint is missing", { runId })
        return "done"
    }
    let nodesFailed = false
    try {
      const unclosed = new Map<DagNodeId, string>()
      await endPausedRunChildren(ports.children, acquired.record, ports.closure, (nodeId, taskId, cause) => {
        const reason = cause instanceof Error ? cause.message : String(cause)
        unclosed.set(nodeId, ` Its child ${taskId} did not close (${reason}) and may still be running.`)
        ports.logger.warn("omo-senpi dag parked run's child did not close", { runId, nodeId, taskId, error: reason })
      })
      const at = new Date().toISOString()
      const message = `the run's scheduler failed again in this session: ${error}`
      const active = acquired.record.nodes.filter((node) => node.state === "scheduled" || node.state === "running")
      const errors = new Map(
        active.map((node) => [
          node.id,
          { code: "task_cancelled" as const, message: message + (unclosed.get(node.id) ?? ""), nodeId: node.id, at },
        ]),
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
      nodesFailed = true
      journal.append(dagRunPausedEvent({ reason: DAG_SCHEDULER_FAILED_PAUSE_REASON }))
      ports.logger.warn("omo-senpi dag run parked after its scheduler failed again", { runId, error })
      return "done"
    } catch (cause) {
      // Belt for every other throwing path: never leave this host's lease on a run nothing drives.
      if (acquired.leaseTaken) releaseDagRunLease(store, runId, ports.probe.hostPid)
      const reason = cause instanceof Error ? cause.message : String(cause)
      ports.logger.error(
        nodesFailed
          ? `omo-senpi dag run ${runId}: writing its scheduler_failed pause failed (${reason}); its nodes are failed and its lease is released; the run still reads running and will be settled at the next session start`
          : `omo-senpi dag run ${runId}: parking it after its scheduler failed again failed (${reason}); its lease is released; the run still reads running and the next session start's recovery takes it`,
        { runId, error: reason },
      )
      return "done"
    } finally {
      failures.delete(runId)
      acquired.reservation?.release()
    }
  }

  // Each turn waits for a release of the run's reservation and repeats only on an answer that another
  // operation of this process held the run (the park's acquisition, or recovery's claim answering busy),
  // so every further turn follows one more reservation of the run; it never spins. Any other answer ends
  // it. Resolves true when recovery took the run for a scheduler of this process (the sequence goes on).
  const handOn = async (runId: DagRunId, parentSessionId: string, first: boolean, error: string): Promise<boolean> => {
    for (;;) {
      await ports.reservations.whenFree(runId)
      const fresh = store.readCheckpoint<DagRunRecordV1>(runId)
      if (fresh === null || fresh.status !== "running" || ports.holdsRun(runId)) {
        ports.logger.info("omo-senpi dag run needs no hand-off after its scheduler failed", {
          runId,
          status: fresh?.status ?? "missing",
        })
        return false
      }
      if (!first) {
        if ((await park(runId, parentSessionId, error)) === "done") return false
        continue
      }
      const answer = (await ports.recover(parentSessionId)).find((outcome) => outcome.runId === runId)
      if (answer?.kind === "resumed" || answer?.kind === "adopted") return true
      if (answer?.reason === "busy") continue
      // No answer: the claim found it not eligible on the fresh record or missing, or recovery is closed.
      ports.logger.info("omo-senpi dag run not handed on: recovery did not take it", {
        runId,
        reason: answer?.reason ?? "not_claimed",
        ...(answer?.holderPid === undefined
          ? { status: store.readCheckpoint<DagRunRecordV1>(runId)?.status ?? "missing" }
          : { holderPid: answer.holderPid }),
      })
      return false
    }
  }

  return {
    settled: (runId: DagRunId): void => {
      failures.delete(runId)
    },
    failed: async (runId: DagRunId, parentSessionId: string, error: string): Promise<void> => {
      const count = (failures.get(runId) ?? 0) + 1
      failures.set(runId, count)
      let handedOn = false
      try {
        handedOn = await handOn(runId, parentSessionId, count === 1, error)
      } catch (cause) {
        ports.logger.error("omo-senpi dag run could not be handed on after its scheduler failed", {
          runId,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        if (!handedOn) failures.delete(runId)
      }
    },
  }
}
