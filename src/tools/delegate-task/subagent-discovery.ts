import { getAgentConfigKey, getAgentDisplayName, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { loadUserAgents, loadProjectAgents } from "../../features/claude-code-agent-loader"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { parseJsoncSafe } from "../../shared/jsonc-parser"
import * as fs from "node:fs"
import { join } from "node:path"

export type AgentMode = "subagent" | "primary" | "all" | undefined

export type AgentInfo = {
  name: string
  mode?: "subagent" | "primary" | "all"
  model?: string | { providerID: string; modelID: string }
}

export function sanitizeSubagentType(subagentType: string): string {
  return subagentType.trim().replace(/^[\/\"'\\]+|[\/\"'\\]+$/g, "").trim()
}

interface OmoConfigWithAgents {
  agents?: Record<string, unknown>
  agent?: Record<string, unknown>
}

function loadOmoConfigAgents(directory: string | undefined): Record<string, { mode?: string; model?: string }> {
  const result: Record<string, { mode?: string; model?: string }> = Object.create(null)
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })

  const configPaths = [
    join(configDir, "oh-my-openagent.json"),
    join(configDir, "oh-my-openagent.jsonc"),
    join(configDir, "oh-my-opencode.json"),
    join(configDir, "oh-my-opencode.jsonc"),
  ]

  if (directory) {
    configPaths.push(
      join(directory, ".opencode", "oh-my-openagent.json"),
      join(directory, ".opencode", "oh-my-openagent.jsonc"),
      join(directory, ".opencode", "oh-my-opencode.json"),
      join(directory, ".opencode", "oh-my-opencode.jsonc"),
    )
  }

  for (const configPath of configPaths) {
    try {
      if (!fs.existsSync(configPath)) continue

      const content = fs.readFileSync(configPath, "utf-8")
      const parseResult = parseJsoncSafe<OmoConfigWithAgents>(content)

      if (!parseResult.data) continue

      const agentsToLoad = parseResult.data.agents || parseResult.data.agent

      if (agentsToLoad && typeof agentsToLoad === "object") {
        for (const [agentName, agentData] of Object.entries(agentsToLoad)) {
          if (Object.hasOwn(result, agentName)) continue
          if (agentData && typeof agentData === "object") {
            const agent = agentData as Record<string, unknown>
            result[agentName] = {
              mode: typeof agent.mode === "string" ? agent.mode : "subagent",
              model: typeof agent.model === "string" ? agent.model : undefined,
            }
          }
        }
      }
    } catch {
      continue
    }
  }

  return result
}

export function mergeWithClaudeCodeAgents(
  serverAgents: AgentInfo[],
  directory: string | undefined,
): AgentInfo[] {
  const userAgentsRecord = loadUserAgents()
  const projectAgentsRecord = loadProjectAgents(directory)
  const omoConfigAgentsRecord = loadOmoConfigAgents(directory)

  const toAgentInfoList = (record: Record<string, { mode?: string; model?: AgentInfo["model"] }>): AgentInfo[] =>
    Object.entries(record).map(([name, config]) => ({
      name,
      mode: config.mode as AgentInfo["mode"],
      model: config.model,
    }))

  const mergedAgentMap = new Map<string, AgentInfo>()
  const addIfAbsent = (agent: AgentInfo): void => {
    const key = agent.name.toLowerCase()
    if (!mergedAgentMap.has(key)) {
      mergedAgentMap.set(key, agent)
    }
  }

  for (const agent of serverAgents) addIfAbsent(agent)
  for (const agent of toAgentInfoList(projectAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(userAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(omoConfigAgentsRecord)) addIfAbsent(agent)

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
  return agents.find(agent => isTaskCallableAgentMode(agent.mode) && matchesRequestedAgent(agent, requestedAgentName))
}

export function listCallableAgentNames(agents: AgentInfo[]): string {
  return agents
    .filter(agent => isTaskCallableAgentMode(agent.mode))
    .map(agent => stripAgentListSortPrefix(agent.name))
    .sort()
    .join(", ")
}
