import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { Type, type Static } from "typebox"

import { validateTaskTarget, type TaskTargetErrorCode } from "@oh-my-opencode/senpi-task"
import {
  DagManagerError,
  type DagCompileError,
  type DagDefinition,
  type DagDiagnostic,
  type DagManager,
  type DagNodeInput,
  type DagRunId,
  type DagRunResult,
  type DagRunSnapshot,
} from "@oh-my-opencode/senpi-task/dag"

export const DAG_TOOL_NAME = "dag"

export const DagToolParams = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("attach"),
      Type.Literal("snapshot"),
      Type.Literal("wait"),
      Type.Literal("cancel"),
    ],
    {
      description:
        "start creates or reuses a run from a definition; attach re-binds to a live run; snapshot reads current state; wait blocks until the run settles; cancel stops it.",
    },
  ),
  definition: Type.Optional(
    Type.Object(
      {
        key: Type.String({ description: "Stable idempotency key for this run within the session; re-starting with the same key and definition reuses the existing run." }),
        name: Type.String({ description: "Human-readable run name shown in status views." }),
        nodes: Type.Array(
          Type.Object({
            id: Type.String({ description: "Node id, unique within the definition; referenced by dependsOn." }),
            prompt: Type.String({ description: "The instruction for this node's child task. MUST be written in English." }),
            label: Type.Optional(Type.String({ description: "Short human label for this node." })),
            category: Type.Optional(Type.String({ description: "Category name to route this node through. Mutually exclusive with subagent_type; required unless subagent_type is given." })),
            subagent_type: Type.Optional(Type.String({ description: "Agent name to invoke directly (e.g. momus). Mutually exclusive with category; required unless category is given." })),
            model: Type.Optional(Type.String({ description: "Explicit model override. Only valid with subagent_type; rejected alongside category, which takes its model from omo.json." })),
            dependsOn: Type.Optional(Type.Array(Type.String(), { description: "Ids of nodes that must finish before this one is scheduled. Ordering only: no output is substituted into this prompt." })),
            task_summary: Type.Optional(Type.String({ description: "One-line summary of this node's work, shown in the run widget." })),
            description: Type.Optional(Type.String({ description: "Short human description of this node." })),
            load_skills: Type.Optional(Type.Array(Type.String(), { description: "Skill names whose SKILL.md content is prepended to this node's prompt." })),
          }),
          { description: "The nodes of the graph. Each node targets EITHER a category OR a subagent_type." },
        ),
      },
      { description: "Graph to run. Required for action=start, ignored otherwise." },
    ),
  ),
  run_id: Type.Optional(Type.String({ description: "Run id returned by start. Required for attach, snapshot, wait, and cancel." })),
  reason: Type.Optional(Type.String({ description: "Optional human-readable reason recorded when cancelling a run." })),
})

export type DagToolInput = Static<typeof DagToolParams>
export type DagToolDefinitionInput = NonNullable<DagToolInput["definition"]>

// Tool-level error vocabulary. Node target failures nest under invalid_definition and carry the
// task-tool validation code verbatim, so the model sees one vocabulary across task and dag.
export type DagToolErrorCode = "invalid_definition" | "definition_conflict" | "run_not_found" | "run_not_owned"

export type DagToolNodeError = {
  readonly node_id: string
  readonly code: TaskTargetErrorCode
  readonly message: string
}

export type DagToolError = {
  readonly code: DagToolErrorCode
  readonly message: string
  readonly nodes: readonly DagToolNodeError[]
  readonly errors: readonly DagCompileError[]
  readonly diagnostics: readonly DagDiagnostic[]
}

export type DagToolDetails =
  | { readonly kind: "started"; readonly run_id: string; readonly reused: boolean; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "attached"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "snapshot"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "waited"; readonly run_id: string; readonly result: DagRunResult }
  | { readonly kind: "cancelled"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "error"; readonly error: DagToolError }

export type DagToolResult = AgentToolResult<DagToolDetails>

export type DagToolDeps = {
  readonly manager: DagManager
  readonly parentSessionId: () => string
  readonly rootSessionId: () => string
  /**
   * Injection point for the scheduler-owned wait surface (createDagWaitSurface().wait). Absent until
   * the scheduler is wired; wait then reports the run's current state instead of blocking.
   */
  readonly wait?: (runId: DagRunId, parentSessionId: string) => Promise<DagRunResult>
  /** Injection point for the scheduler's run cancellation. */
  readonly cancel?: (runId: DagRunId, reason?: string) => void | Promise<void>
}

const DESCRIPTION = [
  "Run a dependency graph of child tasks in one call: nodes execute in parallel waves, and a node starts only after every node it dependsOn has finished.",
  "dependsOn is ordering ONLY - no upstream output is substituted into a downstream prompt, so each prompt must stand alone.",
  "Each node targets EITHER category OR subagent_type, never both; model is an explicit override valid only alongside subagent_type.",
  "start is idempotent per definition key: re-starting the same key with the same graph reuses the run instead of duplicating it.",
].join(" ")

function toolResult(text: string, details: DagToolDetails): DagToolResult {
  return { content: [{ type: "text", text }], details }
}

function failure(
  code: DagToolErrorCode,
  message: string,
  extra: Partial<Omit<DagToolError, "code" | "message">> = {},
): DagToolResult {
  return toolResult(message, {
    kind: "error",
    error: {
      code,
      message,
      nodes: extra.nodes ?? [],
      errors: extra.errors ?? [],
      diagnostics: extra.diagnostics ?? [],
    },
  })
}

// The graph compiler types a node's target as category XOR subagent_type, but tool arguments arrive
// as untrusted JSON. Re-run the task tool's own validator per node so the dag rejects the exact same
// shapes with the exact same codes rather than compiling an impossible route.
function validateNodeTargets(nodes: readonly DagToolDefinitionInput["nodes"][number][]): readonly DagToolNodeError[] {
  const errors: DagToolNodeError[] = []
  for (const node of nodes) {
    const selection = validateTaskTarget({
      ...(node.category === undefined ? {} : { category: node.category }),
      ...(node.subagent_type === undefined ? {} : { subagent_type: node.subagent_type }),
      ...(node.model === undefined ? {} : { model: node.model }),
    })
    if (selection.kind === "error") {
      errors.push({ node_id: node.id, code: selection.error.code, message: selection.error.message })
    }
  }
  return errors
}

function toDefinition(input: DagToolDefinitionInput): DagDefinition {
  return {
    key: input.key,
    name: input.name,
    nodes: input.nodes.map((node): DagNodeInput => {
      const common = {
        id: node.id,
        prompt: node.prompt,
        ...(node.label === undefined ? {} : { label: node.label }),
        ...(node.dependsOn === undefined ? {} : { dependsOn: node.dependsOn }),
        ...(node.task_summary === undefined ? {} : { task_summary: node.task_summary }),
        ...(node.description === undefined ? {} : { description: node.description }),
        ...(node.load_skills === undefined ? {} : { load_skills: node.load_skills }),
      }
      // Target validation already proved exactly one of these is present.
      return node.category !== undefined
        ? { ...common, category: node.category }
        : { ...common, subagent_type: node.subagent_type as string, ...(node.model === undefined ? {} : { model: node.model }) }
    }),
  }
}

function fromManagerError(error: DagManagerError): DagToolResult {
  const code: DagToolErrorCode =
    error.code === "definition_conflict" || error.code === "run_not_found" || error.code === "run_not_owned"
      ? error.code
      : "invalid_definition"
  return failure(code, error.message, { errors: error.errors, diagnostics: error.diagnostics })
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
  if (nodeErrors.length > 0) {
    return failure(
      "invalid_definition",
      nodeErrors.map((error) => `Node "${error.node_id}": ${error.message}`).join(" "),
      { nodes: nodeErrors },
    )
  }
  const result = await deps.manager.start({
    definition: toDefinition(input),
    parentSessionId: deps.parentSessionId(),
    rootSessionId: deps.rootSessionId(),
  })
  const verb = result.reused ? "Reused" : "Started"
  return toolResult(`${verb} dag run ${result.snapshot.runId} (${result.snapshot.counts.total} nodes).`, {
    kind: "started",
    run_id: result.snapshot.runId,
    reused: result.reused,
    snapshot: result.snapshot,
  })
}

async function waitAction(deps: DagToolDeps, runId: string): Promise<DagToolResult> {
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
        return await waitAction(deps, runId)
      case "cancel":
        return await cancelAction(deps, runId, params.reason)
    }
  } catch (error) {
    if (error instanceof DagManagerError) return fromManagerError(error)
    throw error
  }
}

export function createDagTool(deps: DagToolDeps): ToolDefinition<typeof DagToolParams, DagToolDetails> {
  return {
    name: DAG_TOOL_NAME,
    label: "Dag",
    description: DESCRIPTION,
    parameters: DagToolParams,
    execute: (_toolCallId, params) => runDagTool(deps, params),
  }
}
