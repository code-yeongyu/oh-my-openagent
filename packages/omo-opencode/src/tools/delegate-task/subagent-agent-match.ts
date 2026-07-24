import type { ExecutorContext } from "./executor-types"
import { isPlanAgent } from "./constants"
import type { AgentInfo } from "./subagent-discovery"
import {
  findCallableAgentMatch,
  findPrimaryAgentMatch,
  isDemotedPlanAgent,
  listCallableAgentNames,
  mergeWithClaudeCodeAgents,
} from "./subagent-discovery"
import { getAgentConfigKey, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { normalizeSDKResponse } from "../../shared"
import type { ResolveSubagentExecutionOptions, SubagentAgentMatch } from "./subagent-resolution-types"

const DEFAULT_PLAN_FALLBACK_AGENT = "plan"
const RESERVED_HIDDEN_NATIVE_AGENTS = new Set(["build"])

function isReservedHiddenNativeAgent(agentName: string): boolean {
  return RESERVED_HIDDEN_NATIVE_AGENTS.has(getAgentConfigKey(agentName))
}

function shouldUseHiddenPlanAgent(
  requestedAgent: string,
  serverPrimaryAgent: AgentInfo | undefined,
  serverMatchedAgent: AgentInfo | undefined,
  sisyphusAgentConfig: ExecutorContext["sisyphusAgentConfig"],
  hasDemotedPlan: boolean,
): boolean {
  if (serverPrimaryAgent) {
    return false
  }

  if (hasDemotedPlan) {
    return false
  }

  if (serverMatchedAgent) {
    return false
  }

  if (!isPlanAgent(requestedAgent)) {
    return false
  }

  return sisyphusAgentConfig?.planner_enabled !== false
    && sisyphusAgentConfig?.replace_plan !== false
}

export async function resolveSubagentAgentMatch(
  requestedAgent: string,
  executorCtx: ExecutorContext,
  options: ResolveSubagentExecutionOptions,
): Promise<SubagentAgentMatch> {
  const agentsResult = await executorCtx.client.app.agents()
  const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
    preferResponseOnMissingData: true,
  })
  const hasDemotedPlan = agents.some(isDemotedPlanAgent)
  const serverPrimaryAgent = findPrimaryAgentMatch(agents, requestedAgent)
  const serverMatchedAgent = findCallableAgentMatch(agents, requestedAgent)

  const mergedAgents = mergeWithClaudeCodeAgents(agents, executorCtx.directory)
  const matchedPrimaryAgent = findPrimaryAgentMatch(mergedAgents, requestedAgent)
  const useHiddenPlanFallback = shouldUseHiddenPlanAgent(
    requestedAgent,
    serverPrimaryAgent,
    serverMatchedAgent,
    executorCtx.sisyphusAgentConfig,
    hasDemotedPlan,
  )

  if (isReservedHiddenNativeAgent(requestedAgent) && !serverPrimaryAgent && !serverMatchedAgent) {
    return {
      kind: "error",
      result: {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${requestedAgent}". Available agents: ${listCallableAgentNames(agents)}`,
      },
    }
  }

  if (matchedPrimaryAgent && !options.allowPrimaryAgentDelegation && !useHiddenPlanFallback) {
    return {
      kind: "error",
      result: {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot delegate to primary agent "${stripAgentListSortPrefix(matchedPrimaryAgent.name)}" via task. Select that agent directly instead.`,
      },
    }
  }

  const usePrimary = options.allowPrimaryAgentDelegation && matchedPrimaryAgent !== undefined
  let matchedAgent = usePrimary
    ? matchedPrimaryAgent
    : findCallableAgentMatch(mergedAgents, requestedAgent)

  if (useHiddenPlanFallback) {
    matchedAgent = {
      name: DEFAULT_PLAN_FALLBACK_AGENT,
      mode: "subagent",
      hidden: true,
    }
  }

  if (!matchedAgent) {
    return {
      kind: "error",
      result: {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${requestedAgent}". Available agents: ${listCallableAgentNames(mergedAgents)}`,
      },
    }
  }

  return {
    kind: "matched",
    agentToUse: usePrimary ? matchedAgent.name : stripAgentListSortPrefix(matchedAgent.name),
    matchedAgent,
  }
}
