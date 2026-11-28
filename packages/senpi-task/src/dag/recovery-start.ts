import type { ManagerStartSpec } from "../manager/types"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import type { DagPersistedNode, DagRunRecordV1 } from "./manager"
import type { DagTaskOwner, OwnedStartResult } from "./owner"
import { nodeById } from "./scheduler-context"
import type { DagNodeErrorCode, DagNodeId } from "./types"

// What recovery needs to start a scheduled node's child afresh: its spec, its owner, and the mapping
// of a refused start onto the node's error.
export function startSpec(record: DagRunRecordV1, nodeId: DagNodeId, sessionDepth: number): ManagerStartSpec {
  const node = nodeById(record, nodeId)
  const persisted = persistedNode(record, nodeId)
  return {
    prompt: persisted.effectivePrompt,
    ...(persisted.task_summary === undefined ? {} : { task_summary: persisted.task_summary }),
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    depth: sessionDepth + 1,
    ...(node.route.kind === "category"
      ? { category: node.route.category }
      : { subagent_type: node.route.agent, ...(node.route.model === undefined ? {} : { model: node.route.model }) }),
    name: node.id,
    ...(persisted.description === undefined ? {} : { description: persisted.description }),
    run_in_background: true,
  }
}

export function taskOwner(record: DagRunRecordV1, nodeId: DagNodeId): DagTaskOwner {
  // Keyed on the persisted execAttempt, NEVER the display attempt: reattach bumps the display
  // attempt with no new execution, and an attempt-keyed fingerprint would then compute a value the
  // persisted owner record does not hold - a spurious owner_conflict on an untouched resume.
  const execAttempt = nodeById(record, nodeId).execAttempt
  return {
    kind: "dag",
    runId: record.runId,
    nodeId,
    execAttempt: execAttempt ?? 0,
    fingerprint: dagFingerprint(
      ownerFingerprintInput({
        definitionFingerprint: record.definitionFingerprint,
        nodeId,
        ...(execAttempt === undefined ? {} : { execAttempt }),
      }),
    ),
  }
}

export function startFailure(
  result: Exclude<OwnedStartResult, { readonly kind: "started" | "residency_denied" | "held" }>,
): {
  readonly code: DagNodeErrorCode
  readonly message: string
} {
  switch (result.kind) {
    case "depth_denied":
      return { code: "depth_denied", message: result.reason }
    case "plan_unresolved":
      return { code: "plan_unresolved", message: result.error.message }
    case "start_failed":
      return { code: "start_failed", message: result.error_message }
    case "owner_conflict":
      return { code: "start_failed", message: `DAG task owner conflicts with existing task ${result.task_id}` }
  }
}

function persistedNode(record: DagRunRecordV1, nodeId: DagNodeId): DagPersistedNode {
  const node = record.definition.nodes.find((entry) => entry.id === nodeId)
  if (node === undefined) throw new Error(`missing persisted definition for DAG node "${nodeId}"`)
  return node
}
