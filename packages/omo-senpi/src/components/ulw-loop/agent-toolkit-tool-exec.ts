import { readFileSync } from "node:fs"

import { AgentToolkitToolParams, type AgentToolkitToolInput } from "./agent-toolkit-tool-params"
import { createAgentToolkit, type AgentToolkit, type ToolkitSurface } from "../../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
import type { UlwLoopSteeringMutationKind } from "../../../../omo-codex/plugin/components/ulw-loop/src/types.js"

export interface AgentToolkitToolDeps {
  readonly resolveCwd: () => string
  readonly resolveSessionId: () => string | undefined
  readonly resolveGoalPaths: () => readonly string[]
  readonly surface?: ToolkitSurface
  readonly readGoalFile?: (path: string) => string
}

interface ToolFailure {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string }
}

export type AgentToolkitToolResult = Awaited<ReturnType<AgentToolkit["dispatch"]>> | ToolFailure

function failure(code: string, message: string): ToolFailure {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// The SDK is lazily imported to keep it out of the extension bundle, so the steering vocabulary is
// mirrored here as literals; agent-toolkit-tool.test.ts pins it against the toolkit's own constant.
export const STEERING_KINDS = [
  "add_subgoal",
  "split_subgoal",
  "reorder_pending",
  "revise_pending_wording",
  "revise_criterion",
  "annotate_ledger",
  "mark_blocked_superseded",
] as const satisfies readonly UlwLoopSteeringMutationKind[]

function isSteeringKind(value: string): value is UlwLoopSteeringMutationKind {
  return STEERING_KINDS.some((kind) => kind === value)
}

// The snapshot is advisory: a missing or unreadable goal store yields no snapshot, and the
// checkpoint answers with the "no driver" advice instead of refusing the call.
function readDriverGoal(deps: AgentToolkitToolDeps): unknown {
  const read = deps.readGoalFile ?? ((path: string) => readFileSync(path, "utf8"))
  for (const path of deps.resolveGoalPaths()) {
    try {
      const parsed: unknown = JSON.parse(read(path))
      if (isRecord(parsed) && isRecord(parsed["goal"])) return parsed["goal"]
    } catch {
      continue
    }
  }
  return undefined
}

function codexGoalJson(params: AgentToolkitToolInput, deps: AgentToolkitToolDeps): string | undefined {
  const explicit = params.codexGoal
  if (explicit !== undefined) return JSON.stringify({ goal: explicit })
  const derived = readDriverGoal(deps)
  return derived === undefined ? undefined : JSON.stringify({ goal: derived })
}

function requireText(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed.length === 0) {
    throw new MissingField(field)
  }
  return trimmed
}

class MissingField extends Error {
  constructor(readonly field: string) {
    super(`omo_agent_toolkit requires \`${field}\` for this operation.`)
    this.name = "MissingField"
  }
}

function evidenceStatus(value: string): "pass" | "fail" | "blocked" {
  if (value === "pass" || value === "fail" || value === "blocked") return value
  throw new MissingField("status (pass|fail|blocked)")
}

function checkpointStatus(value: string): "complete" | "failed" | "blocked" {
  if (value === "complete" || value === "failed" || value === "blocked") return value
  throw new MissingField("status (complete|failed|blocked)")
}

async function runOperation(
  toolkit: AgentToolkit,
  params: AgentToolkitToolInput,
  deps: AgentToolkitToolDeps,
): Promise<AgentToolkitToolResult> {
  switch (params.operation) {
    case "help":
      return toolkit.help()
    case "status":
      return toolkit.status()
    case "create-goals":
      return toolkit.createGoals({ brief: requireText(params.brief, "brief") })
    case "complete-goals":
      return toolkit.completeGoals(params.retryFailed === true ? { retryFailed: true } : {})
    case "criteria":
      return toolkit.criteria({ goalId: requireText(params.goalId, "goalId") })
    case "record-evidence":
      return toolkit.recordEvidence({
        goalId: requireText(params.goalId, "goalId"),
        criterionId: requireText(params.criterionId, "criterionId"),
        status: evidenceStatus(requireText(params.status, "status")),
        evidence: requireText(params.evidence, "evidence"),
        ...(params.notes === undefined ? {} : { notes: params.notes }),
      })
    case "add-goal":
      return toolkit.addGoal({
        title: requireText(params.title, "title"),
        objective: requireText(params.objective, "objective"),
      })
    case "steer":
      return toolkit.steer(steerProposal(params))
    case "checkpoint":
      return checkpoint(toolkit, params, deps)
    case "record-review-blockers":
      return toolkit.recordReviewBlockers({
        goalId: requireText(params.goalId, "goalId"),
        title: requireText(params.title, "title"),
        objective: requireText(params.objective, "objective"),
        evidence: requireText(params.evidence, "evidence"),
        codexGoalJson: requireText(codexGoalJson(params, deps), "codexGoal"),
      })
    default:
      return failure("ULW_LOOP_OPERATION_UNKNOWN", `Unknown operation: ${String(params.operation)}`)
  }
}

function steerProposal(params: AgentToolkitToolInput): Parameters<AgentToolkit["steer"]>[0] {
  const kind = requireText(params.kind, "kind")
  if (!isSteeringKind(kind)) throw new MissingField("kind (a known steering mutation kind)")
  return {
    kind,
    source: "cli",
    evidence: requireText(params.evidence, "evidence"),
    rationale: requireText(params.rationale, "rationale"),
    ...(params.goalId === undefined ? {} : { goalId: params.goalId, targetGoalId: params.goalId }),
    ...(params.criterionId === undefined ? {} : { criterionId: params.criterionId }),
    ...(params.criterionScenario === undefined ? {} : { scenario: params.criterionScenario }),
    ...(params.criterionExpectedEvidence === undefined ? {} : { expectedEvidence: params.criterionExpectedEvidence }),
  }
}

function checkpoint(
  toolkit: AgentToolkit,
  params: AgentToolkitToolInput,
  deps: AgentToolkitToolDeps,
): Promise<AgentToolkitToolResult> {
  if (params.printTemplate === true) {
    return toolkit.checkpoint({
      printTemplate: true,
      ...(params.goalId === undefined ? {} : { goalId: params.goalId }),
    })
  }
  const snapshot = codexGoalJson(params, deps)
  return toolkit.checkpoint({
    goalId: requireText(params.goalId, "goalId"),
    status: checkpointStatus(requireText(params.status, "status")),
    evidence: requireText(params.evidence, "evidence"),
    ...(snapshot === undefined ? {} : { codexGoalJson: snapshot }),
    ...(params.qualityGate === undefined ? {} : { qualityGateJson: JSON.stringify(params.qualityGate) }),
  })
}

export async function executeAgentToolkit(
  params: AgentToolkitToolInput,
  deps: AgentToolkitToolDeps,
): Promise<AgentToolkitToolResult> {
  const sessionId = deps.resolveSessionId()?.trim()
  if (sessionId === undefined || sessionId.length === 0) {
    return failure(
      "ULW_LOOP_SESSION_ID_REQUIRED",
      "This host did not expose a session id, so the toolkit cannot bind to a plan directory.",
    )
  }
  try {
    const toolkit = createAgentToolkit({ cwd: deps.resolveCwd(), sessionId, surface: deps.surface ?? "omo-senpi" })
    return await runOperation(toolkit, params, deps)
  } catch (error) {
    if (error instanceof MissingField) return failure("ULW_LOOP_ARGUMENT_MISSING", error.message)
    return failure("ULW_LOOP_ERROR", error instanceof Error ? error.message : "unknown toolkit error")
  }
}

export const AGENT_TOOLKIT_TOOL_NAME = "omo_agent_toolkit"

const DESCRIPTION = [
  "Durable ulw-loop plan state for THIS session: goals, success criteria, evidence, checkpoints, and steering.",
  "The session id comes from the host, so never pass a path and never shell out to the toolkit CLI.",
  "The driver goal never gates a checkpoint: the snapshot is filled from this session's goal store and the advice returns in nextActions.",
  "complete-goals ACQUIRES the next pending goal; a run is finished only when every goal has been checkpointed complete.",
].join(" ")

export interface AgentToolkitToolExecutionResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[]
  readonly details: AgentToolkitToolResult
  readonly isError?: boolean
}

function toExecutionResult(envelope: AgentToolkitToolResult): AgentToolkitToolExecutionResult {
  const text = JSON.stringify(envelope)
  return envelope.ok ? { content: [{ type: "text", text }], details: envelope } : { content: [{ type: "text", text }], details: envelope, isError: true }
}

export function createAgentToolkitTool(deps: AgentToolkitToolDeps): {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly parameters: typeof AgentToolkitToolParams
  readonly execute: (
    toolCallId: string,
    params: AgentToolkitToolInput,
  ) => Promise<AgentToolkitToolExecutionResult>
} {
  return {
    name: AGENT_TOOLKIT_TOOL_NAME,
    label: "Agent toolkit",
    description: DESCRIPTION,
    parameters: AgentToolkitToolParams,
    // The host calls every tool as execute(toolCallId, params, signal, onUpdate, ctx); only the
    // first two matter here, and the envelope is returned as text content plus typed details.
    execute: async (_toolCallId: string, params: AgentToolkitToolInput): Promise<AgentToolkitToolExecutionResult> =>
      toExecutionResult(await executeAgentToolkit(params, deps)),
  }
}
