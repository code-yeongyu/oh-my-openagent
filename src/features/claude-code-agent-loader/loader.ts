import { existsSync, readdirSync, readFileSync } from "fs"
import { join, basename } from "path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../../shared/frontmatter"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir, getOpenCodeConfigDir, log } from "../../shared"
import type { AgentScope, AgentFrontmatter, LoadedAgent } from "./types"

function parseToolsConfig(tools?: string | Record<string, boolean>): Record<string, boolean> | undefined {
  if (!tools) return undefined

  if (Array.isArray(tools)) {
    const result: Record<string, boolean> = {}
    for (const tool of tools) {
      if (typeof tool === "string") {
        result[tool.toLowerCase()] = true
      }
    }
    return Object.keys(result).length > 0 ? result : undefined
  }

  if (typeof tools === "object") {
    return tools
  }

  // Handle string format: "tool1, tool2, tool3"
  const toolList = tools.split(",").map((t) => t.trim()).filter(Boolean)
  if (toolList.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of toolList) {
    result[tool.toLowerCase()] = true
  }
  return result
}

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    log("loadAgentsFromDir: directory does not exist", { agentsDir })
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  log("loadAgentsFromDir: found entries", { 
    agentsDir, 
    entries: entries.map(e => ({ name: e.name, isFile: e.isFile() }))
  })
  const agents: LoadedAgent[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    const agentName = basename(entry.name, ".md")

    try {
      const content = readFileSync(agentPath, "utf-8")
      const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

       const name = data.name || agentName
       const originalDescription = data.description || ""

       const formattedDescription = `(${scope}) ${originalDescription}`

       const config: AgentConfig = {
         description: formattedDescription,
         mode: data.mode || "subagent",
         prompt: body.trim(),
       }

       if (data.model) {
         config.model = data.model
       }
       if (data.temperature !== undefined) {
         config.temperature = data.temperature
       }
       if (data.top_p !== undefined) {
         config.top_p = data.top_p
       }
       if (data.color) {
         config.color = data.color
       }
       if (data.permission) {
         config.permission = data.permission
       }

       const toolsConfig = parseToolsConfig(data.tools)
      if (toolsConfig) {
        config.tools = toolsConfig
      }

      log("loadAgentsFromDir: parsed agent successfully", { name, agentPath })
      agents.push({
        name,
        path: agentPath,
        config,
        scope,
      })
    } catch (err) {
      log("loadAgentsFromDir: ERROR parsing agent", { agentPath, error: String(err) })
      continue
    }
  }

  return agents
}

export function loadUserAgents(): Record<string, AgentConfig> {
  // OpenCode uses ~/.config/opencode/agent (singular)
  const opencodeAgentsDir = join(getOpenCodeConfigDir({ binary: "opencode" }), "agent")
  // Claude Code uses ~/.claude/agents (plural)
  const claudeAgentsDir = join(getClaudeConfigDir(), "agents")
  
  log("loadUserAgents searching directories", { opencodeAgentsDir, claudeAgentsDir })
  
  // Load from both locations, OpenCode takes precedence
  const opencodeAgents = loadAgentsFromDir(opencodeAgentsDir, "user")
  const claudeAgents = loadAgentsFromDir(claudeAgentsDir, "user")
  
  log("loadUserAgents found agents", { 
    opencode: opencodeAgents.map(a => a.name), 
    claude: claudeAgents.map(a => a.name) 
  })

  const result: Record<string, AgentConfig> = {}
  // Claude agents first, so OpenCode agents can override
  for (const agent of claudeAgents) {
    result[agent.name] = agent.config
  }
  for (const agent of opencodeAgents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadProjectAgents(): Record<string, AgentConfig> {
  const opencodeProjectAgentsDir = join(process.cwd(), ".opencode", "agent")
  const claudeProjectAgentsDir = join(process.cwd(), ".claude", "agents")
  
  const opencodeAgents = loadAgentsFromDir(opencodeProjectAgentsDir, "project")
  const claudeAgents = loadAgentsFromDir(claudeProjectAgentsDir, "project")

  const result: Record<string, AgentConfig> = {}
  for (const agent of claudeAgents) {
    result[agent.name] = agent.config
  }
  for (const agent of opencodeAgents) {
    result[agent.name] = agent.config
  }
  return result
}
