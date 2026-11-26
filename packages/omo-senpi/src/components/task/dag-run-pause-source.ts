import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import type { DagRecovery, InstalledDagRun } from "../../../../senpi-task/src/dag/recovery"
import type { DagSchedulerOptions } from "../../../../senpi-task/src/dag/scheduler"
import type { DagRunId } from "../../../../senpi-task/src/dag/types"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import { dagRunEligibility, decideDagRun } from "../../../../senpi-task/src/dag/run-acquisition"
import { defaultSignaller } from "../../../../senpi-task/src/lifecycle/context"
import { dispatchGuidance } from "../../../../senpi-task/src/pause/guidance"
import type { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { RunPauseAdmissionHeld } from "../../../../senpi-task/src/manager/run-pause"
import type { RunPauseSource } from "./engine-run-pause"

export type DagGuidanceDelivery = (
  taskId: string,
  input: {
    readonly inputId: string
    readonly revision: number
    readonly text: string
  },
) => Promise<{ readonly entryId?: string }>

/**
 * Journals the user's Stop on one run, decided on the fresh record under the journal's run lock by
 * the acquisition's own decision (`decideDagRun`, #15125). A run another live process schedules
 * (pending or running, or paused under that process's own lease: it has just claimed the run) is
 * left untouched and its holder pid returned; any other live run is paused exactly as before,
 * keeping the previous holder the holder rule reads. Stop never takes the lease: it ends holding.
 */
function stopUnderHolderRule(
  options: DagSchedulerOptions,
  record: DagRunRecordV1,
  pauseSeq: number,
): number | undefined {
  const probe = {
    taskManager: options.taskManager,
    hostPid: options.hostPid ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultSignaller.isAlive,
  }
  let refusedBy: number | undefined
  const journal = controlJournal({ ...options, initialRecord: record }, record, undefined, (fresh) => {
    const decision = decideDagRun(fresh, { probe, eligible: dagRunEligibility.userStop(pauseSeq) })
    if (decision.kind === "not_eligible") return true
    if (decision.kind === "free") return false
    const scheduling = fresh.status !== "paused" || fresh.leaseHolderPid === decision.holderPid
    if (scheduling) refusedBy = decision.holderPid
    return scheduling
  })
  journal.append({ type: "dag.run.paused", reason: "user_stop", pauseSeq })
  return refusedBy
}

type StopPorts = {
  options(record: DagRunRecordV1): DagSchedulerOptions
  warn?(message: string, fields?: Record<string, unknown>): void
}

function stopRuns(ports: StopPorts, records: readonly DagRunRecordV1[], pauseSeq: number): void {
  for (const initial of records) {
    const options = ports.options(initial)
    const record = options.store.readCheckpoint<DagRunRecordV1>(initial.runId)
    if (record === null) continue
    const refusedBy = stopUnderHolderRule(options, record, pauseSeq)
    if (refusedBy !== undefined) {
      ports.warn?.("omo-senpi DAG Stop left a run to the live process that is scheduling it", {
        runId: record.runId,
        holderPid: refusedBy,
      })
    }
  }
}

export function createDagRunPauseSource(ports: {
  readonly barrier: AdmissionBarrier
  records(parentSessionId: string): readonly DagRunRecordV1[]
  options(record: DagRunRecordV1): DagSchedulerOptions
  // Retires the run and returns the release of the reservation it holds until the pause is written.
  retire(runId: DagRunId): Promise<(() => void) | void>
  prepareResume(runId: DagRunId): void
  readonly recovery: DagRecovery
  adopt(installed: InstalledDagRun): void
  cancel(runId: DagRunId): Promise<void>
  readonly deliverGuidance?: DagGuidanceDelivery
  warn?(message: string, fields?: Record<string, unknown>): void
  // Holds the run's reservation (waiting while another operation holds it) and returns its release.
  reserve?(runId: DagRunId): Promise<() => void>
}): RunPauseSource {
  const active = (parent: string) =>
    ports
      .records(parent)
      .filter((record) => record.status === "pending" || record.status === "running" || record.status === "paused")
  const dispatchRunGuidance = async (listed: DagRunRecordV1): Promise<void> => {
    const options = ports.options(listed)
    const record = options.store.readCheckpoint<DagRunRecordV1>(listed.runId) ?? listed
    const journal = controlJournal(options, record)
    const guidance = [...(record.guidance ?? [])].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    for (const entry of guidance) {
      const targets = record.nodes
        .filter((node) => (entry.scope.kind === "node" ? node.id === entry.scope.nodeId : node.state !== "completed"))
        .map((node) => ({
          nodeId: node.id,
          ...(node.state === "running" || node.state === "paused" ? { taskId: node.taskId } : {}),
        }))
      await dispatchGuidance([entry], targets, {
        save: (entries) => {
          for (const guidance of entries)
            journal.append({
              type: guidance.state === "delivered" ? "dag.guidance.delivered" : "dag.guidance.dispatching",
              guidance,
            })
        },
        deliver: async (taskId, input) => {
          if (ports.deliverGuidance === undefined) throw new Error("run guidance custody port is not configured")
          return ports.deliverGuidance(taskId, input)
        },
      })
    }
  }
  return {
    refs: (parent) => active(parent).map((record) => ({ kind: "dag", id: record.runId })),
    async quiesce(parent, pauseSeq) {
      const records = active(parent)
      const retired = await Promise.allSettled(records.map((record) => ports.retire(record.runId)))
      const releases = retired.flatMap((outcome) =>
        outcome.status === "fulfilled" && outcome.value !== undefined ? [outcome.value] : [],
      )
      try {
        const failure = retired.find((outcome) => outcome.status === "rejected")
        if (failure?.status === "rejected") throw failure.reason
        stopRuns(ports, records, pauseSeq)
      } finally {
        for (const release of releases) release()
      }
    },
    async dispatchGuidance(parent) {
      for (const listed of active(parent)) {
        // Delivered and recorded under the run's reservation, from the record read once it is held.
        const release = (await ports.reserve?.(listed.runId)) ?? (() => undefined)
        try {
          await dispatchRunGuidance(listed)
        } finally {
          release()
        }
      }
    },
    async install(parent, pauseSeq, credential) {
      for (const record of active(parent)) {
        if (record.pause?.pauseSeq !== pauseSeq) continue
        const entered = ports.barrier.enter(
          parent,
          { key: `run:dag:${record.runId}`, runRef: { kind: "dag", id: record.runId } },
          credential,
        )
        if (entered.kind === "held") throw new RunPauseAdmissionHeld()
        try {
          ports.prepareResume(record.runId)
          const installed = await ports.recovery.installResumedRun(
            record.runId,
            record.parentSessionId,
            pauseSeq,
            credential,
          )
          if (installed.kind !== "installed") throw new Error(`DAG installation refused: ${installed.kind}`)
          if (entered.ticket.check().kind === "held") {
            await installed.scheduler.suspend()
            await installed.settled
            installed.release()
            throw new RunPauseAdmissionHeld()
          }
          ports.adopt(installed)
        } finally {
          entered.ticket.leave()
        }
      }
    },
    async cancel(parent, runRef) {
      if (runRef.kind !== "dag" || !active(parent).some((record) => record.runId === runRef.id)) return
      await ports.cancel(runRef.id as DagRunId)
    },
  }
}
