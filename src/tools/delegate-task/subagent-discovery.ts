import { loadProjectAgents, loadUserAgents } from "../../features/claude-code-agent-loader"
import {
  getAgentConfigKey,
  getAgentDisplayName,
  stripAgentListSortPrefix,
} from "../../shared/agent-display-names"

export type AgentMode = "subagent" | "primary" | "all" | undefined

export type AgentInfo = {
  name: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  model?: string | { providerID: string; modelID: string }
}

export function sanitizeSubagentType(subagentType: string): string {
  return subagentType.trim().replace(/^[\\/"']+|[\\/"']+$/g, "").trim()
}

export function mergeWithClaudeCodeAgents(
  serverAgents: AgentInfo[],
  directory: string | undefined,
): AgentInfo[] {
  const userAgentsRecord = loadUserAgents()
  const projectAgentsRecord = loadProjectAgents(directory)

  const toAgentInfoList = (record: Record<string, { mode?: string; hidden?: boolean; model?: AgentInfo["model"] }>): AgentInfo[] =>
    Object.entries(record).map(([name, config]) => ({
      name,
      mode: config.mode as AgentInfo["mode"],
      hidden: config.hidden,
      model: config.model,
    }))

  const mergedAgentMap = new Map<string, AgentInfo>()
  const addIfAbsent = (agent: AgentInfo): void => {
    const key = stripAgentListSortPrefix(agent.name).trim().toLowerCase()
    if (!mergedAgentMap.has(key)) {
      mergedAgentMap.set(key, agent)
    }
  }

  for (const agent of serverAgents) addIfAbsent(agent)
  for (const agent of toAgentInfoList(projectAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(userAgentsRecord)) addIfAbsent(agent)

  return Array.from(mergedAgentMap.values())
}

function buildComparableNames(agentName: string): Set<string> {
  return new Set([
    agentName,
    getAgentDisplayName(agentName),
    getAgentConfigKey(agentName),
  ].map(name => stripAgentListSortPrefix(name).trim().toLowerCase()))
}

function matchesRequestedAgent(agent: AgentInfo, requestedAgentName: string): boolean {
  const comparableNames = buildComparableNames(requestedAgentName)
  const listedAgentName = stripAgentListSortPrefix(agent.name).trim().toLowerCase()
  const listedAgentConfigKey = getAgentConfigKey(agent.name).trim().toLowerCase()

  return comparableNames.has(listedAgentName) || comparableNames.has(listedAgentConfigKey)
}

export function isTaskCallableAgentMode(mode: AgentMode): boolean {
  return mode === "all" || mode === "subagent"
}

export function isDemotedPlanAgent(agent: AgentInfo): boolean {
  return agent.hidden === true
    && agent.mode === "subagent"
    && stripAgentListSortPrefix(agent.name).trim().toLowerCase() === "plan"
}

function isVisibleToTask(agent: AgentInfo): boolean {
  return agent.hidden !== true || isDemotedPlanAgent(agent)
}

export function findPrimaryAgentMatch(
  agents: AgentInfo[],
  requestedAgentName: string,
): AgentInfo | undefined {
  return agents.find(agent => agent.mode === "primary" && matchesRequestedAgent(agent, requestedAgentName))
}

export function findCallableAgentMatch(
  agents: AgentInfo[],
  requestedAgentName: string,
): AgentInfo | undefined {
  return agents.find(agent => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent) && matchesRequestedAgent(agent, requestedAgentName))
}

export function listCallableAgentNames(agents: AgentInfo[]): string {
  return agents
    .filter(agent => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent))
    .map(agent => stripAgentListSortPrefix(agent.name))
    .sort()
    .join(", ")
}
