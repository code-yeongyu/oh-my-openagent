import type { RunPauseOwner } from "../pause/ports"
import { controlJournal, ownedRecord } from "./node-control-context"
import { requireUserPaused } from "./paused-controls"
import type { DagSchedulerOptions } from "./scheduler"

export type PausedChildRecoveryPort = {
  inspect(taskId: string): "live" | "restorable" | "lost"
  restorePaused(taskId: string, owner: RunPauseOwner): Promise<{ readonly childSeq: number }>
}

export async function recoverPausedDagChildren(options: DagSchedulerOptions, port: PausedChildRecoveryPort): Promise<void> {
  const record = ownedRecord(options, options.initialRecord.runId)
  requireUserPaused(record)
  const pauseSeq = record.pause?.pauseSeq
  if (pauseSeq === undefined) throw new Error("paused run has no pause sequence")
  for (const node of record.nodes) {
    if (node.state !== "paused" || node.taskId === undefined) continue
    const fresh = ownedRecord(options, record.runId)
    if (fresh.pause?.pauseSeq !== pauseSeq || fresh.status !== "paused") return
    const journal = controlJournal(options, fresh)
    switch (port.inspect(node.taskId)) {
      case "live": break
      case "lost":
        journal.append({ type: "dag.node.pause-lost", nodeId: node.id, error: {
          code: "lost_while_paused", message: `task ${node.taskId} cannot be restored`, nodeId: node.id,
          at: new Date((options.now ?? Date.now)()).toISOString(),
        } })
        break
      case "restorable": {
        const receipt = await port.restorePaused(node.taskId, {
          parentSessionId: record.parentSessionId, parentPauseSeq: pauseSeq, runRef: { kind: "dag", id: record.runId },
        })
        const current = ownedRecord(options, record.runId)
        if (current.pause?.pauseSeq !== pauseSeq || current.status !== "paused") return
        controlJournal(options, current).append({ type: "dag.node.pause-recovered", nodeId: node.id, childSeq: receipt.childSeq })
        break
      }
    }
  }
}
