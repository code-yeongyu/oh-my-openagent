import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import type { AgentScope, ClaudeCodeAgentConfig, LoadedAgent } from "./types"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { parseMarkdownAgentFile } from "./agent-definitions-loader"

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  const agents: LoadedAgent[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    const agent = parseMarkdownAgentFile(agentPath, scope)

    if (agent) {
      agents.push(agent)
    }
  }

  return agents
}

export function loadUserAgents(): Record<string, ClaudeCodeAgentConfig> {
  const userAgentsDir = join(getClaudeConfigDir(), "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user")

  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig> {
  const projectAgentsDir = join(directory ?? process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")

  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadOpencodeGlobalAgents(): Record<string, ClaudeCodeAgentConfig> {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const opencodeAgentsDir = join(configDir, "agents")
  const agents = loadAgentsFromDir(opencodeAgentsDir, "opencode")

  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadOpencodeProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig> {
  const opencodeProjectDir = join(directory ?? process.cwd(), ".opencode", "agents")
  const agents = loadAgentsFromDir(opencodeProjectDir, "opencode-project")

  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}
