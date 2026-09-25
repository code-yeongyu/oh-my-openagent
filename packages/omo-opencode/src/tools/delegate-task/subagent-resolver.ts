import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { log } from "../../shared/logger"
import { resolveSubagentAgentMatch } from "./subagent-agent-match"
import { resolveSubagentModel } from "./subagent-model-resolution"
import { validateSubagentRequest } from "./subagent-request-preflight"
import type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult } from "./subagent-resolution-types"

export type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult }

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string,
  options: ResolveSubagentExecutionOptions = {},
): Promise<ResolveSubagentExecutionResult> {
  const preflight = validateSubagentRequest(args, parentAgent, categoryExamples, options)
  if (preflight.kind === "invalid") {
    return preflight.result
  }

  let agentToUse = preflight.agentName

  try {
    const agentMatch = await resolveSubagentAgentMatch(agentToUse, executorCtx, options)
    if (agentMatch.kind === "error") {
      return agentMatch.result
    }

    agentToUse = agentMatch.agentToUse
    const { categoryModel, fallbackChain, error: modelError } = await resolveSubagentModel(agentToUse, agentMatch.matchedAgent, executorCtx)
    if (modelError) {
      log("[delegate-task] Subagent model resolution failed — failing fast before child-session creation", {
        requestedAgent: agentToUse,
        parentAgent,
        error: modelError,
      })
      return { agentToUse: "", categoryModel: undefined, error: modelError }
    }
    return { agentToUse, categoryModel, fallbackChain }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }
}
