import type { DagRunRecordV1 } from "./manager"
import type { DagEdge, DagNodeId } from "./types"

export function pausedAmendmentUnsafe(record: DagRunRecordV1, nodeId: DagNodeId): boolean {
  const node = record.nodes.find((entry) => entry.id === nodeId)
  return (
    node?.state === "running" ||
    node?.state === "paused" ||
    (node?.state === "scheduled" && (record.pause?.reason !== "user_stop" || node.taskId !== undefined))
  )
}

// Every node downstream of the seeds: an amendment that changes or adds a node invalidates them.
export function transitiveDependents(edges: readonly DagEdge[], seeds: readonly DagNodeId[]): DagNodeId[] {
  const dependents = new Map<DagNodeId, DagNodeId[]>()
  for (const edge of edges) dependents.set(edge.from, [...(dependents.get(edge.from) ?? []), edge.to])
  const visited = new Set<DagNodeId>()
  const queue = [...seeds]
  while (queue.length > 0) {
    const id = queue.shift() as DagNodeId
    if (visited.has(id)) continue
    visited.add(id)
    queue.push(...(dependents.get(id) ?? []))
  }
  return [...visited]
}
