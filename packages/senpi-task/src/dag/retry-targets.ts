// Which nodes a retry may take and which skipped dependents come back with them.
import type { DagRunRecordV1 } from "./manager"
import { DagNodeControlError } from "./node-control-context"
import type { DagNode, DagNodeId, DagNodeState, DagRunId } from "./types"

const RETRYABLE_NODE_STATES: ReadonlySet<DagNodeState> = new Set(["failed", "cancelled", "skipped"])

export function defaultRetryTargets(record: DagRunRecordV1): DagNodeId[] {
  const seeds = record.nodes
    .filter((node) => node.state === "failed" || node.state === "cancelled")
    .map((node) => node.id)
  return [...seeds, ...skippedDependentsOf(record, seeds).map((node) => node.id)]
}

// Transitive skipped dependents of the retry set: the cascade skipped them, so retrying their
// blocking ancestor must hand them back to the scheduler loop as blocked work.
export function skippedDependentsOf(record: DagRunRecordV1, seeds: readonly DagNodeId[]): readonly DagNode[] {
  const selected = new Set(seeds)
  const restored: DagNode[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const node of record.nodes) {
      if (node.state !== "skipped" || selected.has(node.id)) continue
      if (!node.dependsOn.some((dependencyId) => selected.has(dependencyId))) continue
      selected.add(node.id)
      restored.push(node)
      changed = true
    }
  }
  return restored
}

export function assertRetryable(record: DagRunRecordV1, runId: DagRunId, targets: readonly DagNodeId[]): void {
  const selected = new Set(targets)
  for (const nodeId of targets) {
    const node = record.nodes.find((entry) => entry.id === nodeId)
    if (node === undefined) {
      throw new DagNodeControlError({
        code: "node_not_found",
        message: `unknown dag node "${nodeId}"`,
        runId,
        nodeIds: [nodeId],
      })
    }
    if (node.state === "completed") {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" already completed; amend the definition to re-run it`,
        runId,
        nodeIds: [nodeId],
      })
    }
    if (!RETRYABLE_NODE_STATES.has(node.state)) {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" is ${node.state}; only failed, cancelled, or skipped nodes can be retried`,
        runId,
        nodeIds: [nodeId],
      })
    }
    if (node.state !== "skipped") continue
    // A skipped node whose blocking ancestor stays failed is re-skipped by the dependent cascade
    // the moment the scheduler loop runs, so every such ancestor must be part of the same retry set.
    const blocking = blockingAncestors(record, node).filter((ancestorId) => !selected.has(ancestorId))
    if (blocking.length > 0) {
      throw new DagNodeControlError({
        code: "node_not_retryable",
        message: `dag node "${nodeId}" was skipped because ${blocking.join(", ")} did not complete; retry those in the same call`,
        runId,
        nodeIds: [nodeId, ...blocking],
      })
    }
  }
}

function blockingAncestors(record: DagRunRecordV1, node: DagNode): readonly DagNodeId[] {
  const blocking = new Set<DagNodeId>()
  const seen = new Set<DagNodeId>([node.id])
  const queue = [...node.dependsOn]
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (seen.has(id)) continue
    seen.add(id)
    const ancestor = record.nodes.find((entry) => entry.id === id)
    if (ancestor === undefined) continue
    if (ancestor.state === "failed" || ancestor.state === "cancelled") blocking.add(id)
    if (ancestor.state === "skipped") queue.push(...ancestor.dependsOn)
  }
  return [...blocking]
}
