import type { ToolDefinition } from "@code-yeongyu/senpi"

import { lintDagDefinitionNodes } from "./dag-lint"
import { loadSenpiBarrel } from "../../../../senpi-task/src/lazy/senpi-barrel"
import { DagManagerError, type DagRunId } from "@oh-my-opencode/senpi-task/dag"
// The per-node control verbs are not on the package's dag barrel; the runtime already reaches the
// scheduler module by path for the same reason, and both resolve to the same source file, so the
// instanceof check below stays sound.
import { DagNodeControlError } from "../../../../senpi-task/src/dag/scheduler"
import { amendAction, retryAction, sendAction } from "./dag-tool-control"
import {
  failure,
  invalidNodeTargets,
  toDefinition,
  toolResult,
  validateNodeTargets,
  type DagToolDeps,
  type DagToolDetails,
  type DagToolErrorCode,
  type DagToolResult,
} from "./dag-tool-contract"
import { DagToolParams, type DagToolInput } from "./dag-tool-params"

export const WORKFLOW_TOOL_NAME = "workflow"

// The schema and the wire contract live beside this module and are re-exported so the tool keeps
// ONE public import surface.
export { DagToolParams } from "./dag-tool-params"
export type { DagToolInput, DagToolDefinitionInput } from "./dag-tool-params"
export type {
  DagToolDeps,
  DagToolDetails,
  DagToolError,
  DagToolErrorCode,
  DagToolNodeError,
  DagToolResult,
  DagToolSendDelivery,
  DagToolSendOutcome,
} from "./dag-tool-contract"

const DESCRIPTION = [
  "Dependency-graph execution for child tasks. COMPOSE THE SPEC PROGRAMMATICALLY INSIDE AN eval CELL - the kernel exposes this tool as `tool.workflow` alongside a JS SDK, so build the graph as code: partition the work into logically distinct steps, name one node per step, and wire the ordering as data. A graph is a program; write it as one instead of hand-authoring a call.",
  "A node starts only after every node it dependsOn has finished, and unrelated nodes run in parallel up to the resident-child cap.",
  "dependsOn is ordering ONLY - no upstream output is substituted into a downstream prompt, so each prompt must stand alone.",
  "Each node targets EITHER category OR subagent_type, never both; model is an explicit override valid only alongside subagent_type.",
  "start is idempotent per definition key: re-starting the same key with the same graph reuses the run instead of duplicating it.",
  "wait detaches by default against a live run: the session is woken as each node completes and when the run settles, and detach=false restores the blocking wait that returns the final result.",
  "When a run settles badly, do NOT start a new one: retry re-runs the failed nodes in place, amend edits the graph and re-runs only what changed, and send steers or revives one node's child.",
].join(" ")

// Every manager code except invalid_definition is already tool vocabulary, so it passes through
// untouched; only compile failures collapse onto invalid_definition with their diagnostics.
function fromManagerError(error: DagManagerError): DagToolResult {
  const code: DagToolErrorCode = error.code === "invalid_definition" ? "invalid_definition" : error.code
  return failure(code, error.message, {
    errors: error.errors,
    diagnostics: error.diagnostics,
    node_ids: error.nodeIds,
  })
}

// The engine's control-verb vocabulary IS the tool's, so the code survives the boundary verbatim
// and the refused node ids ride along untouched.
function fromControlError(error: DagNodeControlError): DagToolResult {
  return failure(error.code, error.message, { node_ids: error.nodeIds })
}

function requireRunId(params: DagToolInput): string | undefined {
  const runId = params.run_id
  return runId !== undefined && runId.trim().length > 0 ? runId.trim() : undefined
}

async function startAction(deps: DagToolDeps, params: DagToolInput): Promise<DagToolResult> {
  const input = params.definition
  if (input === undefined) {
    return failure("invalid_definition", "action=start requires a definition. Provide definition.key, definition.name, and definition.nodes.")
  }
  const nodeErrors = validateNodeTargets(input.nodes)
  if (nodeErrors.length > 0) return invalidNodeTargets(nodeErrors)
  const warnings = lintDagDefinitionNodes(input.nodes)
  // Dag skill materialization discovers skills synchronously through the senpi barrel. Warm the
  // lazy boundary at this async tool entry point before the manager reaches that hook.
  await loadSenpiBarrel()
  const result = await deps.manager.start({
    definition: toDefinition(input),
    parentSessionId: deps.parentSessionId(),
    rootSessionId: deps.rootSessionId(),
  })
  const verb = result.reused ? "Reused" : "Started"
  const warningText =
    warnings.length === 0
      ? ""
      : ` Advisory warnings (fix the definition and re-start under a new key to clear them): ${warnings.join(" | ")}`
  return toolResult(`${verb} dag run ${result.snapshot.runId} (${result.snapshot.counts.total} nodes).${warningText}`, {
    kind: "started",
    run_id: result.snapshot.runId,
    reused: result.reused,
    snapshot: result.snapshot,
    warnings,
  })
}

// Structural mirror of the engine's terminal vocabulary (senpi-task keeps its own private set in
// handle.ts; dag-wake-source.ts mirrors it the same way) so an already-settled run never takes the
// detached path.
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"])

async function waitAction(deps: DagToolDeps, params: DagToolInput, runId: string): Promise<DagToolResult> {
  const parentSessionId = deps.parentSessionId()
  // Ownership is enforced before dispatch so an unknown or foreign run never reaches the scheduler.
  const snapshot = deps.manager.snapshot(runId as DagRunId, parentSessionId)
  if (deps.wait === undefined) {
    return toolResult(`Dag run ${runId} is ${snapshot.status}; no wait surface is wired in this session.`, {
      kind: "waited",
      run_id: runId,
      result: { runId: runId as DagRunId, status: snapshot.status, snapshot, nodes: {} },
    })
  }
  // The model-facing default detaches monitor-style against a live run: node completion
  // notifications and the terminal dag-run wake already reach the session through the idle
  // coordinator, so holding the tool call open only freezes the turn. A terminal run resolves
  // immediately through the wait surface either way, and detach=false keeps the blocking contract
  // the eval SDK and dag library rely on.
  if (params.detach !== false && !TERMINAL_RUN_STATUSES.has(snapshot.status)) {
    return toolResult(
      `Detached from dag run ${runId} (${snapshot.status}, ${snapshot.counts.completed}/${snapshot.counts.total} nodes complete). The session is woken as each node completes and again when the run settles; use action=snapshot for a midpoint peek or action=wait with detach=false to block until settle.`,
      {
        kind: "detached",
        run_id: runId,
        snapshot,
      },
    )
  }
  const result = await deps.wait(runId as DagRunId, parentSessionId)
  return toolResult(`Dag run ${runId} finished with status ${result.status}.`, {
    kind: "waited",
    run_id: runId,
    result,
  })
}

async function cancelAction(deps: DagToolDeps, runId: string, reason?: string): Promise<DagToolResult> {
  const parentSessionId = deps.parentSessionId()
  deps.manager.snapshot(runId as DagRunId, parentSessionId)
  await deps.cancel?.(runId as DagRunId, reason)
  const snapshot = deps.manager.snapshot(runId as DagRunId, parentSessionId)
  return toolResult(`Cancelled dag run ${runId}${reason === undefined ? "" : ` (${reason})`}.`, {
    kind: "cancelled",
    run_id: runId,
    snapshot,
  })
}

export async function runDagTool(deps: DagToolDeps, params: DagToolInput): Promise<DagToolResult> {
  try {
    if (params.action === "start") return await startAction(deps, params)

    const runId = requireRunId(params)
    if (runId === undefined) {
      return failure("run_not_found", `action=${params.action} requires run_id.`)
    }
    switch (params.action) {
      case "attach": {
        const handle = deps.manager.attach(runId as DagRunId, deps.parentSessionId())
        const snapshot = handle.snapshot()
        return toolResult(`Attached to dag run ${runId} (${snapshot.status}).`, {
          kind: "attached",
          run_id: runId,
          snapshot,
        })
      }
      case "snapshot": {
        const snapshot = deps.manager.snapshot(runId as DagRunId, deps.parentSessionId())
        return toolResult(`Dag run ${runId} is ${snapshot.status} (${snapshot.counts.completed}/${snapshot.counts.total} nodes complete).`, {
          kind: "snapshot",
          run_id: runId,
          snapshot,
        })
      }
      case "wait":
        return await waitAction(deps, params, runId)
      case "cancel":
        return await cancelAction(deps, runId, params.reason)
      case "retry":
        return await retryAction(deps, params, runId)
      case "send":
        return await sendAction(deps, params, runId)
      case "amend":
        return await amendAction(deps, params, runId)
    }
  } catch (error) {
    if (error instanceof DagManagerError) return fromManagerError(error)
    if (error instanceof DagNodeControlError) return fromControlError(error)
    throw error
  }
}

export function createDagTool(deps: DagToolDeps): ToolDefinition<typeof DagToolParams, DagToolDetails> {
  return {
    name: WORKFLOW_TOOL_NAME,
    label: "Workflow",
    description: DESCRIPTION,
    parameters: DagToolParams,
    execute: (_toolCallId, params) => runDagTool(deps, params),
  }
}
