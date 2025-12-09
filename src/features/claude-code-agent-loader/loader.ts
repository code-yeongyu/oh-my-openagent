import { existsSync, readdirSync, readFileSync } from "fs"
import { homedir } from "os"
import { join, basename } from "path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../../shared/frontmatter"
import type { AgentScope, AgentFrontmatter, LoadedAgent } from "./types"

function parseToolsConfig(toolsStr?: string): Record<string, boolean> | undefined {
  if (!toolsStr) return undefined

  const tools = toolsStr.split(",").map((t) => t.trim()).filter(Boolean)
  if (tools.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of tools) {
    result[tool.toLowerCase()] = true
  }
  return result
}

function isMarkdownFile(entry: { name: string; isFile: () => boolean }): boolean {
  return !entry.name.startsWith(".") && entry.name.endsWith(".md") && entry.isFile()
}

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
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
         mode: "subagent",
         prompt: body.trim(),
       }

       const toolsConfig = parseToolsConfig(data.tools)
      if (toolsConfig) {
        config.tools = toolsConfig
      }

      agents.push({
        name,
        path: agentPath,
        config,
        scope,
      })
    } catch {
      continue
    }
  }

  return agents
}

export function loadUserAgents(): Record<string, AgentConfig> {
  const userAgentsDir = join(homedir(), ".claude", "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user")

  const result: Record<string, AgentConfig> = {}
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadProjectAgents(): Record<string, AgentConfig> {
  const projectAgentsDir = join(process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")

  const result: Record<string, AgentConfig> = {}
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}
