import { defaultSignaller } from "../lifecycle/context"
import type { DagRunRecordV1 } from "./manager"
import type { DagNodeId } from "./types"

export function pausedAmendmentUnsafe(record: DagRunRecordV1, nodeId: DagNodeId): boolean {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  return (
    node?.state === "running" ||
    node?.state === "paused" ||
    (node?.state === "scheduled" && (record.pause?.reason !== "user_stop" || node.taskId !== undefined))
  )
}

// "Another" live lease: this process is never one (the run's own holder or the host that paused it).
export function liveLeaseHolder(record: DagRunRecordV1): boolean {
  const pid = record.leaseHolderPid ?? record.previousLeaseHolderPid
  return pid !== undefined && pid !== process.pid && defaultSignaller.isAlive(pid)
}
