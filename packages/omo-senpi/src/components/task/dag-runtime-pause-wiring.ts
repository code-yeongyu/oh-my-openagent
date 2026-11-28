import type {
  DagFileStore,
  DagManager,
  DagRecovery,
  DagRunId,
  DagRunRecordV1,
  DagSchedulerOptions,
  InstalledDagRun,
} from "@oh-my-opencode/senpi-task/dag"

import { reserveWhenFree, type DagRunReservations } from "../../../../senpi-task/src/dag/run-acquisition"
import { createDagRunPauseSource, type DagGuidanceDelivery } from "./dag-run-pause-source"
import type { OwnedScheduler } from "./dag-scheduler-registry"
import type { TaskEngine } from "./engine"
import type { ComponentLogger } from "../../extension/types"
import { ownedSubtree } from "./engine-run-pause"

/**
 * A user Stop's retirement of one run's scheduler in this runtime. It holds the run's reservation from
 * before retirement until the Stop's pause is written (the caller releases it), so no installation
 * or verb of this process can take the run in between (#15125).
 */
export function createStopRetirement(ports: {
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly reservations: DagRunReservations
  readonly stoppedAdmissions: Set<DagRunId>
}) {
  const { schedulers } = ports
  return async (runId: DagRunId): Promise<() => void> => {
    const reservation = await reserveWhenFree(ports.reservations, runId, "stop")
    try {
      ports.stoppedAdmissions.add(runId)
      const owned = schedulers.get(runId)
      if (owned !== undefined) {
        await owned.scheduler.suspend()
        await Promise.allSettled([owned.running])
        if (schedulers.get(runId) === owned) schedulers.delete(runId)
      }
    } catch (error) {
      reservation.release()
      throw error
    }
    return reservation.release
  }
}

/** The runtime's ports for the user Stop / Resume run-pause source (`dag-run-pause-source.ts`). */
export function registerDagPauseSource(ports: {
  readonly deps: {
    readonly engine: TaskEngine
    readonly pausedGuidance?: DagGuidanceDelivery
    readonly logger: ComponentLogger
  }
  readonly coreManager: DagManager
  readonly store: DagFileStore
  readonly schedulerOptions: Omit<DagSchedulerOptions, "initialRecord">
  readonly schedulers: Map<DagRunId, OwnedScheduler>
  readonly reservations: DagRunReservations
  readonly stoppedAdmissions: Set<DagRunId>
  readonly recovery: DagRecovery
  clearAdmissionLatch(runId: DagRunId): void
  adoptInstalled(installed: InstalledDagRun): void
  cancelRun(runId: DagRunId, parentSessionId: string, reason?: string): Promise<unknown>
}): (() => void) | undefined {
  const { deps, coreManager } = ports
  return deps.engine.runPause?.register(
    createDagRunPauseSource({
      barrier: deps.engine.admissionBarrier,
      records: (parent) => {
        const subtree = ownedSubtree(
          deps.engine.manager.list({ scope: "all" }).map((entry) => entry.record),
          parent,
        )
        const sessions = new Set([
          parent,
          ...subtree.flatMap((record) => (record.child_session_id === undefined ? [] : [record.child_session_id])),
        ])
        return [...sessions].flatMap((session) =>
          coreManager.list(session).map((run) => coreManager.record(run.runId, session)),
        )
      },
      options: (record) => ({ ...ports.schedulerOptions, initialRecord: record }),
      retire: createStopRetirement(ports),
      prepareResume: (runId) => ports.clearAdmissionLatch(runId),
      warn: (message, fields) => deps.logger.warn(message, fields),
      reserve: async (runId) => (await reserveWhenFree(ports.reservations, runId, "guidance dispatch")).release,
      recovery: ports.recovery,
      adopt: ports.adoptInstalled,
      cancel: async (runId) => {
        const record = ports.store.readCheckpoint<DagRunRecordV1>(runId)
        if (record !== null) await ports.cancelRun(runId, record.parentSessionId, "run_cancelled")
      },
      deliverGuidance:
        deps.pausedGuidance ??
        (async (taskId, input) => {
          const held = await deps.engine.manager.holdTaskInput(taskId, input)
          if (held.kind === "input_id_conflict")
            throw new Error(`guidance ${input.inputId} conflicts with held revision ${held.heldRevision}`)
          return held.kind === "held" ? { entryId: held.entryId } : {}
        }),
    }),
  )
}
