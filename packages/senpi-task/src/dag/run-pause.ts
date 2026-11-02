import type { DagRunRecordV1 } from "./manager"
import type { DagRunEvent } from "./types"

// Shared by live scheduling and WAL replay. Shutdown never erases a human Stop.
export function applyRunPause(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 | undefined {
  if (event.type === "dag.run.paused") {
    if (event.reason !== "user_stop") return { ...record, status: "paused", updatedAt: event.at }
    if (event.pauseSeq === undefined) throw new Error("user_stop requires its pause sequence")
    return {
      ...record, status: "paused", pause: { reason: "user_stop", pauseSeq: event.pauseSeq }, updatedAt: event.at,
      nodes: record.nodes.map(node => node.state === "running"
        ? { ...node, state: "paused" } : node),
    }
  }
  if (event.type !== "dag.run.resumed") return undefined
  const { pause: _pause, completedAt: _completedAt, retryOnResume: _retryOnResume, ...resumed } = record
  return {
    ...resumed, status: "running", generation: event.generation, updatedAt: event.at,
    nodes: record.nodes.map(node => node.state === "paused"
      ? { ...node, state: node.taskId === undefined ? "pending" : "running" } : node),
  }
}
