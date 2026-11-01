import type { ExecutionMode, ManagerStartSpec } from "../manager/types"
import { resolveDagNodeExecutionMode } from "./execution-mode"
import { dagFingerprint, ownerFingerprintInput } from "./fingerprint"
import type { DagTaskOwner } from "./owner"
import type { DagRoute } from "./types"
import { nodeById, type SchedulerContext } from "./scheduler-context"
import type { DagNodeId } from "./types"
import type { DagRunRecordV1 } from "./manager"

function dagNodeExecutionMode(
  context: SchedulerContext,
  route: DagRoute,
): { readonly execution_mode?: ExecutionMode } {
  if (context.executionMode === undefined) return {}
  const mode = resolveDagNodeExecutionMode({ ...context.executionMode, route })
  return mode === undefined ? {} : { execution_mode: mode }
}

export function startSpec(context: SchedulerContext, nodeId: DagNodeId): ManagerStartSpec {
  const record = context.journal.snapshot()
  const node = nodeById(record, nodeId)
  const persisted = context.definitionNodes.get(nodeId)
  if (persisted === undefined) throw new Error(`missing persisted definition for DAG node "${nodeId}"`)
  const spec: ManagerStartSpec = {
    prompt: persisted.effectivePrompt,
    ...(persisted.task_summary === undefined ? {} : { task_summary: persisted.task_summary }),
    parent_session_id: record.parentSessionId,
    root_session_id: record.rootSessionId,
    depth: (context.ancestry?.depth ?? 0) + 1,
    ...dagNodeExecutionMode(context, node.route),
    ...(node.route.kind === "category"
      ? { category: node.route.category }
      : { subagent_type: node.route.agent, ...(node.route.model === undefined ? {} : { model: node.route.model }) }),
    name: node.id,
    ...(persisted.description === undefined ? {} : { description: persisted.description }),
    run_in_background: true,
  }
  if (node.route.kind !== "category" && context.nodeSpawnPolicy !== undefined) {
    const verdict = context.nodeSpawnPolicy({
      nodeId,
      subagentType: node.route.agent,
      prompt: spec.prompt,
      parentSessionId: record.parentSessionId,
    })
    if (verdict.kind === "deny") {
      throw new Error(`DAG node "${nodeId}" denied by spawn policy: ${verdict.message}`)
    }
    if (verdict.kind === "force") return { ...spec, prompt: verdict.prompt }
  }
  return spec
}

export function owner(context: SchedulerContext, nodeId: DagNodeId): DagTaskOwner {
  const record = context.journal.snapshot()
  const execAttempt = nodeById(record, nodeId).execAttempt
  return {
    kind: "dag",
    runId: record.runId,
    nodeId,
    // execAttempt (NOT the display attempt) scopes the owner identity: a retried or
    // amend-invalidated node claims a new one, while an untouched node keeps the legacy value.
    fingerprint: dagFingerprint(ownerFingerprintInput({
      definitionFingerprint: record.definitionFingerprint,
      nodeId,
      ...(execAttempt === undefined ? {} : { execAttempt }),
    })),
  }
}

export function isRunnable(record: DagRunRecordV1, nodeId: DagNodeId): boolean {
  const node = nodeById(record, nodeId)
  return (node.state === "pending" || node.state === "blocked") &&
    node.dependsOn.every((dependencyId) => nodeById(record, dependencyId).state === "completed")
}
