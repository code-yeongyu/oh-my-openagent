// The record of a turn held while the user stopped the run (#11381), on its node: folded from its
// diagnostic event, cleared when the node is acted on, worded for the read surfaces. Pure; the write
// is `held-trigger.ts`.
import type { DagHeldTrigger } from "./diagnostic-types"
import type { DagRunRecordV1 } from "./manager"
import type { DagNode, DagRunEvent } from "./types"

/** The reducer for `dag.diagnostic.added`: a held trigger folds into its node; any other diagnostic is listed. */
export function applyDiagnostic(
  record: DagRunRecordV1,
  event: Extract<DagRunEvent, { readonly type: "dag.diagnostic.added" }>,
): DagRunRecordV1 {
  const { diagnostic } = event
  if (diagnostic.kind !== "node_flag" || diagnostic.heldTrigger === undefined)
    return { ...record, diagnostics: [...record.diagnostics, diagnostic], updatedAt: event.at }
  const fact = diagnostic.heldTrigger
  const fold = (held: DagHeldTrigger | undefined): DagHeldTrigger =>
    held?.taskId === fact.taskId
      ? { ...held, count: held.count + 1, lastAt: event.at }
      : { ...fact, count: 1, firstAt: event.at, lastAt: event.at }
  const nodes = record.nodes.map((node) =>
    node.id === diagnostic.nodeId ? { ...node, heldTrigger: fold(node.heldTrigger) } : node,
  )
  return { ...record, nodes, updatedAt: event.at }
}

/** The node was sent to, retried, amended or re-opened: its held trigger is answered. */
export function clearHeldTrigger(node: DagNode): DagNode {
  if (node.heldTrigger === undefined) return node
  const { heldTrigger: _answered, ...rest } = node
  return rest
}

export function heldTriggerNotice(nodes: readonly Pick<DagNode, "id" | "heldTrigger">[]): string {
  return nodes
    .flatMap(({ id, heldTrigger: held }) => {
      if (held === undefined) return []
      const repeats = held.count === 1 ? "" : ` (${held.count} times since ${held.firstAt})`
      return [
        ` Node ${id} held while stopped: a trigger fired at ${held.lastAt}${repeats}; send to the node to continue.`,
      ]
    })
    .join("")
}
