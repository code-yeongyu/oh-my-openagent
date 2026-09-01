// The dag tool's three per-node control verbs: retry (fresh attempt), send (steer or revive), and
// amend (edit the definition). Each validates its own arguments before touching the runtime, so an
// impossible request is refused without a round trip through the scheduler.
import type { DagRunId } from "@oh-my-opencode/senpi-task/dag"

import {
  failure,
  invalidNodeTargets,
  toDefinition,
  toolResult,
  validateNodeTargets,
  type DagToolDeps,
  type DagToolResult,
} from "./dag-tool-contract"
import type { DagToolInput } from "./dag-tool-params"

// retry selects nodes through EITHER node_id or node_ids, never both, and a prompt override is only
// meaningful for exactly one node - the engine refuses a wider override, so the tool refuses it here
// with the same code instead of paying for a round trip.
function retryTargets(
  params: DagToolInput,
): { readonly kind: "ok"; readonly nodeIds?: readonly string[] } | { readonly kind: "error"; readonly result: DagToolResult } {
  if (params.node_id !== undefined && params.node_ids !== undefined) {
    return { kind: "error", result: failure("invalid_arguments", "action=retry accepts node_id OR node_ids, never both.") }
  }
  const selected = params.node_id !== undefined ? [params.node_id] : params.node_ids
  if (params.prompt !== undefined && (selected === undefined || selected.length !== 1)) {
    return { kind: "error", result: failure("invalid_arguments", "action=retry accepts prompt only alongside exactly one node id.") }
  }
  return { kind: "ok", ...(selected === undefined ? {} : { nodeIds: selected }) }
}

export async function retryAction(deps: DagToolDeps, params: DagToolInput, runId: string): Promise<DagToolResult> {
  // Ownership is enforced before dispatch so an unknown or foreign run never reaches the scheduler.
  deps.manager.snapshot(runId as DagRunId, deps.parentSessionId())
  const targets = retryTargets(params)
  if (targets.kind === "error") return targets.result
  const nodeIds = targets.nodeIds
  if (deps.retry === undefined) {
    return failure("run_still_active", `Dag run ${runId} has no retry surface wired in this session.`)
  }
  const snapshot = params.prompt === undefined
    ? await deps.retry(runId as DagRunId, nodeIds)
    : await deps.retry(runId as DagRunId, nodeIds, { prompt: params.prompt })
  const scope = nodeIds === undefined ? "every failed or cancelled node" : nodeIds.join(", ")
  return toolResult(`Retried ${scope} on dag run ${runId}; it is now ${snapshot.status}.`, {
    kind: "retried",
    run_id: runId,
    ...(nodeIds === undefined ? {} : { node_ids: nodeIds }),
    snapshot,
  })
}

export async function sendAction(deps: DagToolDeps, params: DagToolInput, runId: string): Promise<DagToolResult> {
  deps.manager.snapshot(runId as DagRunId, deps.parentSessionId())
  const nodeId = params.node_id
  if (nodeId === undefined || nodeId.trim().length === 0) {
    return failure("invalid_arguments", "action=send requires node_id.")
  }
  const message = params.message
  if (message === undefined || message.trim().length === 0) {
    return failure("invalid_arguments", "action=send requires a non-empty message.")
  }
  if (deps.send === undefined) {
    return failure("node_not_continuable", `Dag run ${runId} has no send surface wired in this session.`)
  }
  const sent = await deps.send(runId as DagRunId, nodeId.trim(), message)
  return toolResult(`Delivered the message to dag node ${sent.nodeId} (${sent.delivery}).`, {
    kind: "sent",
    run_id: runId,
    node_id: sent.nodeId,
    task_id: sent.taskId,
    delivery: sent.delivery,
    ...(sent.queuePosition === undefined ? {} : { queue_position: sent.queuePosition }),
  })
}

export async function amendAction(deps: DagToolDeps, params: DagToolInput, runId: string): Promise<DagToolResult> {
  deps.manager.snapshot(runId as DagRunId, deps.parentSessionId())
  const input = params.definition
  if (input === undefined) {
    return failure("invalid_arguments", "action=amend requires a definition carrying the edited graph.")
  }
  const nodeErrors = validateNodeTargets(input.nodes)
  if (nodeErrors.length > 0) return invalidNodeTargets(nodeErrors)
  if (deps.amend === undefined) {
    return failure("invalid_amendment", `Dag run ${runId} has no amend surface wired in this session.`)
  }
  const snapshot = await deps.amend(runId as DagRunId, toDefinition(input))
  return toolResult(`Amended dag run ${runId}; it is now ${snapshot.status}.`, {
    kind: "amended",
    run_id: runId,
    snapshot,
  })
}
