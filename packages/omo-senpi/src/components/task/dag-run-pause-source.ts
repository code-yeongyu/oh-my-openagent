import type { DagRunRecordV1 } from "../../../../senpi-task/src/dag/manager"
import type { DagRecovery, InstalledDagRun } from "../../../../senpi-task/src/dag/recovery"
import type { DagSchedulerOptions } from "../../../../senpi-task/src/dag/scheduler"
import type { DagRunId } from "../../../../senpi-task/src/dag/types"
import { controlJournal } from "../../../../senpi-task/src/dag/node-control-context"
import { dispatchGuidance } from "../../../../senpi-task/src/pause/guidance"
import type { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import { RunPauseAdmissionHeld } from "../../../../senpi-task/src/manager/run-pause"
import type { RunPauseSource } from "./engine-run-pause"

export type DagGuidanceDelivery = (taskId: string, input: {
  readonly inputId: string; readonly revision: number; readonly text: string
}) => Promise<{ readonly entryId?: string }>

export function createDagRunPauseSource(ports: {
  readonly barrier: AdmissionBarrier
  records(parentSessionId: string): readonly DagRunRecordV1[]
  options(record: DagRunRecordV1): DagSchedulerOptions
  retire(runId: DagRunId): Promise<void>
  prepareResume(runId: DagRunId): void
  readonly recovery: DagRecovery
  adopt(installed: InstalledDagRun): void
  cancel(runId: DagRunId): Promise<void>
  readonly deliverGuidance?: DagGuidanceDelivery
}): RunPauseSource {
  const active = (parent: string) => ports.records(parent).filter(record =>
    record.status === "pending" || record.status === "running" || record.status === "paused")
  return {
    refs: parent => active(parent).map(record => ({ kind: "dag", id: record.runId })),
    async quiesce(parent, pauseSeq) {
      const records = active(parent)
      await Promise.all(records.map(record => ports.retire(record.runId)))
      for (const initial of records) {
        const options = ports.options(initial)
        const record = options.store.readCheckpoint<DagRunRecordV1>(initial.runId)
        if (record === null || (record.status !== "pending" && record.status !== "running" && record.status !== "paused")) continue
        if ((record.pause?.pauseSeq ?? 0) >= pauseSeq) continue
        controlJournal({ ...options, initialRecord: record }, record).append({ type: "dag.run.paused", reason: "user_stop", pauseSeq })
      }
    },
    async dispatchGuidance(parent) {
      for (const record of active(parent)) {
        const options = ports.options(record)
        const journal = controlJournal(options, record)
        const guidance = [...(record.guidance ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        for (const entry of guidance) {
          const targets = record.nodes.filter(node => entry.scope.kind === "node" ? node.id === entry.scope.nodeId : node.state !== "completed")
            .map(node => ({ nodeId: node.id, ...(node.state === "running" || node.state === "paused" ? { taskId: node.taskId } : {}) }))
          await dispatchGuidance([entry], targets, {
            save: entries => {
              for (const guidance of entries) journal.append({
                type: guidance.state === "delivered" ? "dag.guidance.delivered" : "dag.guidance.dispatching", guidance,
              })
            },
            deliver: async (taskId, input) => {
              if (ports.deliverGuidance === undefined) throw new Error("run guidance custody port is not configured")
              return ports.deliverGuidance(taskId, input)
            },
          })
        }
      }
    },
    async install(parent, pauseSeq, credential) {
      for (const record of active(parent)) {
        if (record.pause?.pauseSeq !== pauseSeq) continue
        const entered = ports.barrier.enter(parent, { key: `run:dag:${record.runId}`, runRef: { kind: "dag", id: record.runId } }, credential)
        if (entered.kind === "held") throw new RunPauseAdmissionHeld()
        try {
          ports.prepareResume(record.runId)
          const installed = await ports.recovery.installResumedRun(record.runId, record.parentSessionId, pauseSeq, credential)
          if (installed.kind !== "installed") throw new Error(`DAG installation refused: ${installed.kind}`)
          if (entered.ticket.check().kind === "held") {
            await installed.scheduler.suspend()
            await installed.settled
            throw new RunPauseAdmissionHeld()
          }
          ports.adopt(installed)
        } finally { entered.ticket.leave() }
      }
    },
    async cancel(parent, runRef) {
      if (runRef.kind !== "dag" || !active(parent).some(record => record.runId === runRef.id)) return
      await ports.cancel(runRef.id as DagRunId)
    },
  }
}
