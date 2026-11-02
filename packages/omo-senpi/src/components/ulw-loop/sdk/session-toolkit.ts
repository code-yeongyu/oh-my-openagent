import {
  createAgentToolkit,
  ULW_LOOP_OPERATIONS,
  type AgentToolkit,
  type RecordReviewBlockersArgs,
  type ToolkitDispatchRequest,
  type ToolkitUnknownRequest,
  type ToolkitFailure,
  type ToolkitResponseFor,
  type ToolkitResultFor,
  type ToolkitSuccess,
} from "../../../../../omo-codex/plugin/components/ulw-loop/src/sdk.js"
import { UlwLoopError } from "../../../../../omo-codex/plugin/components/ulw-loop/src/runtime.js"
import { readDriverGoalJson } from "./driver-goal"
import { driverRelationOf, type SessionDriverRelation } from "./driver-relation"
import { toolkitContextFromEnv, type SessionCwdSource, type SessionToolkitContext } from "./session-binding"

export interface SessionBinding {
  readonly cwd: string
  readonly cwdSource: SessionCwdSource
  readonly sessionId: string
  readonly goalStorePaths: readonly string[]
}
export type SessionStatusResult = ToolkitResultFor<"status"> & { readonly binding: SessionBinding; readonly driver: SessionDriverRelation }
export type SessionStatusResponse = ToolkitSuccess<"status", SessionStatusResult> | ToolkitFailure<"status">
export interface SessionHelpUsage {
  readonly import: string
  readonly example: string
  readonly sessionEnv: readonly string[]
}
export type SessionHelpResult = ToolkitResultFor<"help"> & { readonly usage: SessionHelpUsage }
export type SessionHelpResponse = ToolkitSuccess<"help", SessionHelpResult> | ToolkitFailure<"help">
export const SESSION_HELP_USAGE: SessionHelpUsage = {
  import: 'const { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)',
  example: 'print(await agentToolkit.status()); await agentToolkit.recordEvidence({ goalId: "G001", criterionId: "C001", status: "pass", evidence: "<observable proof>", artifacts: ["<existing path>"] })',
  sessionEnv: ["PI_SESSION_ID", "PI_SESSION_CWD", "PI_SESSION_FILE", "PI_GOAL_STORE_FILE"],
}
export type SessionRecordReviewBlockersArgs = Omit<RecordReviewBlockersArgs, "codexGoalJson"> & { readonly codexGoalJson?: string }
export type SessionAgentToolkit = Omit<AgentToolkit, "recordReviewBlockers" | "status" | "help"> & {
  readonly help: () => Promise<SessionHelpResponse>
  readonly status: () => Promise<SessionStatusResponse>
  readonly recordReviewBlockers: (args: SessionRecordReviewBlockersArgs) => Promise<ToolkitResponseFor<"record-review-blockers">>
}

function failure<Operation extends string>(operation: Operation, error: unknown): ToolkitFailure<Operation> {
  return {
    ok: false,
    operation,
    error: {
      code: error instanceof UlwLoopError ? error.code : "ULW_LOOP_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function withWarnings<Response extends { readonly ok: boolean }>(response: Response, warnings: readonly string[]): Response {
  if (warnings.length === 0) return response
  const existing = "warnings" in response && Array.isArray(response.warnings) ? response.warnings : []
  return { ...response, warnings: [...existing, ...warnings] }
}

// Binding and snapshot reads happen on the synchronous portion of each call, never at import time.
// Binding warnings (cwd or goal-store fallbacks) ride every envelope, failures included, so a
// plan-missing error after a fallback explains which cwd it looked under.
async function invoke<Operation extends string, Result extends { readonly ok: boolean }>(
  operation: Operation,
  run: (toolkit: AgentToolkit, context: SessionToolkitContext, warnings: string[]) => Promise<Result>,
): Promise<Result | ToolkitFailure<Operation>> {
  const warnings: string[] = []
  try {
    const context = toolkitContextFromEnv(process.env)
    warnings.push(...context.warnings)
    const toolkit = createAgentToolkit(context)
    return withWarnings(await run(toolkit, context, warnings), warnings)
  } catch (error) {
    return withWarnings(failure(operation, error), warnings)
  }
}

function snapshot(explicit: string | undefined, context: SessionToolkitContext, warnings: string[]): string | undefined {
  if (explicit !== undefined) return explicit
  const derived = readDriverGoalJson(context.goalStorePaths)
  warnings.push(...derived.warnings)
  return derived.codexGoalJson
}

function bindingOf(context: SessionToolkitContext): SessionBinding {
  return { cwd: context.cwd, cwdSource: context.cwdSource, sessionId: context.rawSessionId, goalStorePaths: context.goalStorePaths }
}

function isKnownRequest(request: ToolkitDispatchRequest | ToolkitUnknownRequest): request is ToolkitDispatchRequest {
  return ULW_LOOP_OPERATIONS.some(operation => operation === request.operation)
}

export const agentToolkit: SessionAgentToolkit = {
  help: () => invoke("help", async (toolkit): Promise<SessionHelpResponse> => {
    const response = await toolkit.help()
    return response.ok ? { ...response, result: { ...response.result, usage: SESSION_HELP_USAGE } } : response
  }),
  status: () => invoke("status", async (toolkit, context, warnings): Promise<SessionStatusResponse> => {
    const response = await toolkit.status()
    if (!response.ok) return response
    const driver = driverRelationOf(response.result.plan, context.goalStorePaths, warnings)
    return { ...response, result: { ...response.result, binding: bindingOf(context), driver } }
  }),
  createGoals: args => invoke("create-goals", toolkit => toolkit.createGoals(args)),
  completeGoals: args => invoke("complete-goals", toolkit => toolkit.completeGoals(args)),
  criteria: args => invoke("criteria", toolkit => toolkit.criteria(args)),
  recordEvidence: args => invoke("record-evidence", toolkit => toolkit.recordEvidence(args)),
  addGoal: args => invoke("add-goal", toolkit => toolkit.addGoal(args)),
  steer: args => invoke("steer", toolkit => toolkit.steer(args)),
  checkpoint: args => invoke("checkpoint", (toolkit, context, warnings) => {
    if (args.printTemplate === true) return toolkit.checkpoint(args)
    const codexGoalJson = snapshot(args.codexGoalJson, context, warnings)
    return toolkit.checkpoint({ ...args, ...(codexGoalJson === undefined ? {} : { codexGoalJson }) })
  }),
  recordReviewBlockers: args => invoke("record-review-blockers", (toolkit, context, warnings) => {
    const codexGoalJson = snapshot(args.codexGoalJson, context, warnings)
    if (codexGoalJson === undefined) throw new UlwLoopError("A driver goal snapshot is required.", "ULW_LOOP_ARGUMENT_MISSING")
    return toolkit.recordReviewBlockers({ ...args, codexGoalJson })
  }),
  dispatch: request => {
    if (isKnownRequest(request)) {
      if (request.operation === "help") return agentToolkit.help()
      if (request.operation === "status") return agentToolkit.status()
      if (request.operation === "checkpoint") return agentToolkit.checkpoint(request.args)
      if (request.operation === "record-review-blockers") return agentToolkit.recordReviewBlockers(request.args)
    }
    return invoke(request.operation, toolkit => toolkit.dispatch(request))
  },
}
