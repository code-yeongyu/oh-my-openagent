import type { Guidance } from "../pause/guidance"
import type { DagRunRecordV1 } from "./manager"
import type { DagNodeError, DagNodeId } from "./types"

export type PausedDagEvent =
  | { readonly type: "dag.guidance.added" | "dag.guidance.edited" | "dag.guidance.removed" | "dag.guidance.dispatching" | "dag.guidance.delivered"; readonly guidance: Guidance }
  | { readonly type: "dag.node.cancel_requested"; readonly nodeId: DagNodeId }
  | { readonly type: "dag.node.retry-staged"; readonly nodeIds: readonly DagNodeId[] }
  | { readonly type: "dag.node.pause-recovered"; readonly nodeId: DagNodeId; readonly childSeq: number }
  | { readonly type: "dag.node.pause-lost"; readonly nodeId: DagNodeId; readonly error: DagNodeError }

export function applyPausedDagEvent(record: DagRunRecordV1, event: PausedDagEvent & { readonly at: string }): DagRunRecordV1 {
  switch (event.type) {
    case "dag.guidance.added":
    case "dag.guidance.edited":
    case "dag.guidance.removed":
    case "dag.guidance.dispatching":
    case "dag.guidance.delivered":
      return { ...record, updatedAt: event.at, guidance: [
        ...(record.guidance ?? []).filter(entry => entry.id !== event.guidance.id), event.guidance,
      ] }
    case "dag.node.cancel_requested":
      return { ...record, updatedAt: event.at, cancelRequestedNodes: [...new Set([...(record.cancelRequestedNodes ?? []), event.nodeId])] }
    case "dag.node.retry-staged":
      return { ...record, updatedAt: event.at, retryOnResume: [...new Set([...(record.retryOnResume ?? []), ...event.nodeIds])] }
    case "dag.node.pause-recovered":
      return { ...record, updatedAt: event.at, pausedChildAcks: { ...record.pausedChildAcks, [event.nodeId]: event.childSeq } }
    case "dag.node.pause-lost":
      return { ...record, updatedAt: event.at, nodes: record.nodes.map(node => node.id === event.nodeId
        ? { ...node, state: "failed", error: event.error, completedAt: event.at } : node) }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}

export function isPausedDagEvent(event: { readonly type: string }): event is PausedDagEvent {
  return event.type.startsWith("dag.guidance.") || event.type === "dag.node.cancel_requested"
    || event.type === "dag.node.retry-staged" || event.type === "dag.node.pause-recovered" || event.type === "dag.node.pause-lost"
}
