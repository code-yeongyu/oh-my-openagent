import type { ToolDefinition } from "@code-yeongyu/senpi"
import type { WorkpoolEngine } from "../workpool/engine"
import { parseInput, WorkpoolCommandSchema } from "../workpool/schema"
import { WorkpoolError, type WorkpoolCaller } from "../workpool/types"
import { evaluateSpawnPolicy } from "./task/spawn-policy"
import type { TaskToolContext, TaskToolDeps } from "./task/types"
import { WorkpoolParams, WorkpoolWorkerYieldParams } from "./workpool-schema"
import { markWorkpoolYieldTool } from "../workpool/worker-tool-identity"

export type WorkpoolToolDeps = TaskToolDeps & { readonly workpools: WorkpoolEngine }
export type WorkpoolToolResult = {
  readonly content: { readonly type: "text"; readonly text: string }[]
  readonly details: Record<string, unknown>
  readonly isError?: boolean
}
function result(details: Record<string, unknown>): WorkpoolToolResult {
  return { content: [{ type: "text", text: JSON.stringify(details) }], details }
}
function failure(error: unknown): WorkpoolToolResult {
  if (!(error instanceof WorkpoolError)) throw error
  return { ...result({ error: { code: error.code, message: error.message } }), isError: true }
}

export function buildWorkpoolExecute(deps: WorkpoolToolDeps) {
  deps.workpools.setSpawnPolicy((agent, parent) => {
    if (agent.subagent_type === undefined) return
    const policy = evaluateSpawnPolicy(deps, agent.subagent_type, agent.prompt, parent)
    if (policy.kind === "deny") throw new WorkpoolError("policy_denied", policy.message)
    if (policy.kind === "force" && policy.prompt !== agent.prompt) throw new WorkpoolError("policy_denied", "The worker's recorded prompt no longer matches the current spawn policy.")
  })
  return async (value: unknown, ctx: TaskToolContext): Promise<WorkpoolToolResult> => {
    try {
      const input = parseInput(WorkpoolCommandSchema, value)
      const sessionId = ctx.sessionManager.getSessionId()
      const ancestry = deps.resolveAncestry?.(sessionId)
      const caller: WorkpoolCaller = { sessionId, rootSessionId: ancestry?.rootSessionId ?? sessionId, depth: ancestry?.depth ?? 0, cwd: ctx.cwd }
      switch (input.op) {
        case "create": {
          let agent = input.agent
          if ("subagent_type" in agent) {
            const policy = evaluateSpawnPolicy(deps, agent.subagent_type, agent.prompt, sessionId)
            if (policy.kind === "deny") throw new WorkpoolError("policy_denied", policy.message)
            if (policy.kind === "force") agent = { ...agent, prompt: policy.prompt }
          }
          const { op: _op, ...create } = input
          // Requested worker tools are resolved against the caller's LIVE capability first; only the
          // normalized names reach the persisted pool record.
          const request = { ...create, agent }
          const grant = await deps.workpools.resolveKernelTools(caller, request, ctx.kernelTools, deps.resolveChildToolNames?.())
          return result(deps.workpools.create(caller, request, grant))
        }
        case "push": return result(deps.workpools.push(caller, input.pool_id, input.items))
        case "inspect": return result(deps.workpools.inspect(caller, input.pool_id))
        case "close": return result(deps.workpools.close(caller, input.pool_id))
        case "cancel": return result(deps.workpools.cancel(caller, input.pool_id))
        case "yield": throw new WorkpoolError("worker_unassigned", "Only an assigned worker's host wrapper may yield.")
        default: return exhaustive(input)
      }
    } catch (error) { return failure(error) }
  }
}
function exhaustive(value: never): never { throw new Error(`Unhandled workpool operation: ${String(value)}`) }

export function createWorkpoolTool(deps: WorkpoolToolDeps): ToolDefinition<typeof WorkpoolParams, Record<string, unknown>> {
  const execute = buildWorkpoolExecute(deps)
  return {
    name: "workpool", label: "Workpool", description: "Create and inspect engine-owned keyed work queues. Push returns durable IDs without waiting for capacity. Omitted mode uses the approved keep_alive default; fresh remains selectable. Inspect reads durable keyed data or errors; close delivers one aggregate; uncertain delivery is never retried automatically.",
    parameters: WorkpoolParams,
    execute: (_id, params, _signal, _update, ctx) => execute(params, ctx),
  }
}

export function createWorkpoolWorkerTool(deps: {
  readonly workpools: Pick<WorkpoolEngine, "yieldResults">
  readonly taskId: string
  readonly runEpoch: () => number
}): ToolDefinition {
  return markWorkpoolYieldTool({
    name: "workpool", label: "Workpool yield", description: "Yield JSON data or a typed error for each assigned key. Identical repeated yields are idempotent; conflicting or stale yields are refused. This tool cannot schedule or spawn workers.",
    parameters: WorkpoolWorkerYieldParams,
    execute: async (_id, params) => {
      try {
        const yielded = deps.workpools.yieldResults(deps.taskId, deps.runEpoch(), params)
        return { ...result(yielded), ...(yielded.results.some(receipt => receipt.status === "refused") ? { isError: true } : {}) }
      }
      catch (error) { return failure(error) }
    },
  })
}
