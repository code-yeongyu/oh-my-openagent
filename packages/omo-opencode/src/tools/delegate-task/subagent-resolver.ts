import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { log } from "../../shared/logger"
import { resolveSubagentAgentMatch } from "./subagent-agent-match"
import { resolveSubagentModel } from "./subagent-model-resolution"
import { validateSubagentRequest } from "./subagent-request-preflight"
import { isDemotedPlanAgent } from "./subagent-discovery"
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
    if (isDemotedPlanAgent(agentMatch.matchedAgent)) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot delegate to coordinator agent "${agentToUse}" via task(). Hidden plan agents share the Prometheus orchestration lane and must not be used as subagent targets — doing so bypasses the Prometheus coordinator guard. Select a worker agent (e.g., sisyphus-junior via category, hephaestus, oracle) instead.`,
      }
    }

    const { categoryModel, fallbackChain } = await resolveSubagentModel(agentToUse, agentMatch.matchedAgent, executorCtx)
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
