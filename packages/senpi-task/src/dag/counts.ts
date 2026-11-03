import type { DagNode, DagNodeCounts } from "./types"

export function countDagNodes(nodes: readonly DagNode[]): DagNodeCounts {
  const counts = {
    total: nodes.length, pending: 0, blocked: 0, scheduled: 0, running: 0,
    completed: 0, failed: 0, cancelled: 0, skipped: 0,
  }
  let paused = 0
  for (const node of nodes) {
    if (node.state === "paused") paused += 1
    else counts[node.state] += 1
  }
  return paused === 0 ? counts : { ...counts, paused }
}
