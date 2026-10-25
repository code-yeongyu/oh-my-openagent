// Frozen from R0 (ebd01f84e): the node states R0 knows and its node count projection
// (dag/manager.ts countNodes). A state outside this list makes R0's counts NaN.
export const R0_DAG_NODE_STATES: readonly string[] = ["pending", "blocked", "scheduled", "running", "completed", "failed", "cancelled", "skipped"]

export function r0CountNodes(nodes: readonly { readonly state: string }[]): Record<string, number> {
  const counts: Record<string, number> = {
    total: nodes.length, pending: 0, blocked: 0, scheduled: 0, running: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0,
  }
  for (const node of nodes) counts[node.state] = (counts[node.state] as number) + 1
  return counts
}
