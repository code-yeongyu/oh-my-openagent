// The dag tool's wire contract: the result/error shapes every action returns, the injection seams
// the runtime fills, and the two constructors that keep every action's envelope identical.
import type { AgentToolResult } from "@code-yeongyu/senpi"

import { validateTaskTarget, type TaskTargetErrorCode } from "@oh-my-opencode/senpi-task"
import type {
  DagCompileError,
  DagDefinition,
  DagDiagnostic,
  DagManager,
  DagNodeInput,
  DagRunId,
  DagRunResult,
  DagRunSnapshot,
} from "@oh-my-opencode/senpi-task/dag"

import type { DagToolDefinitionInput } from "./dag-tool-params"

// Tool-level error vocabulary. Node target failures nest under invalid_definition and carry the
// task-tool validation code verbatim, so the model sees one vocabulary across task and dag. The
// control-verb codes are the engine's own refusal vocabulary, surfaced verbatim rather than
// flattened, so a model can tell "this node cannot be retried" from "this run is still running".
export type DagToolErrorCode =
  | "invalid_definition"
  | "definition_conflict"
  | "run_not_found"
  | "run_not_owned"
  | "invalid_arguments"
  | "node_not_found"
  | "node_not_retryable"
  | "node_not_continuable"
  | "node_has_no_task"
  | "amend_running_node"
  | "invalid_amendment"
  | "run_still_active"

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
  /** Nodes named by a control-verb refusal (retry/send/amend). Empty for definition failures. */
  readonly node_ids: readonly string[]
}

/** How the engine delivered a send: steered into a live turn, revived a resident child, or queued. */
export type DagToolSendDelivery = "steer" | "revive" | "queued"

export type DagToolSendOutcome = {
  readonly nodeId: string
  readonly taskId: string
  readonly delivery: DagToolSendDelivery
  readonly queuePosition?: number
}

export type DagToolDetails =
  | {
      readonly kind: "started"
      readonly run_id: string
      readonly reused: boolean
      readonly snapshot: DagRunSnapshot
      readonly warnings?: readonly string[]
    }
  | { readonly kind: "attached"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "snapshot"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "waited"; readonly run_id: string; readonly result: DagRunResult }
  | { readonly kind: "detached"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | { readonly kind: "cancelled"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
  | {
      readonly kind: "retried"
      readonly run_id: string
      readonly node_ids?: readonly string[]
      readonly snapshot: DagRunSnapshot
    }
  | {
      readonly kind: "sent"
      readonly run_id: string
      readonly node_id: string
      readonly task_id: string
      readonly delivery: DagToolSendDelivery
      readonly queue_position?: number
    }
  | { readonly kind: "amended"; readonly run_id: string; readonly snapshot: DagRunSnapshot }
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
  /** Injection point for the runtime's retry entry point (fresh scheduler, run re-entered). */
  readonly retry?: (
    runId: DagRunId,
    nodeIds?: readonly string[],
    options?: { readonly prompt?: string },
  ) => Promise<DagRunSnapshot>
  /** Injection point for the runtime's per-node send (steer a running child, revive a resident one). */
  readonly send?: (runId: DagRunId, nodeId: string, message: string) => Promise<DagToolSendOutcome>
  /** Injection point for the runtime's amend entry point (edit the definition, re-enter the run). */
  readonly amend?: (runId: DagRunId, definition: DagDefinition) => Promise<DagRunSnapshot>
}

export function toolResult(text: string, details: DagToolDetails): DagToolResult {
  return { content: [{ type: "text", text }], details }
}

export function failure(
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
      node_ids: extra.node_ids ?? [],
    },
  })
}

// The graph compiler types a node's target as category XOR subagent_type, but tool arguments arrive
// as untrusted JSON. Re-run the task tool's own validator per node so the dag rejects the exact same
// shapes with the exact same codes rather than compiling an impossible route.
export function validateNodeTargets(
  nodes: readonly DagToolDefinitionInput["nodes"][number][],
): readonly DagToolNodeError[] {
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

export function invalidNodeTargets(nodeErrors: readonly DagToolNodeError[]): DagToolResult {
  return failure(
    "invalid_definition",
    nodeErrors.map((error) => `Node "${error.node_id}": ${error.message}`).join(" "),
    { nodes: nodeErrors },
  )
}

export function toDefinition(input: DagToolDefinitionInput): DagDefinition {
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
