import { existsSync, readdirSync, readFileSync } from "fs"
import { basename, join } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { isMarkdownFile } from "../../shared/file-utils"
import { log } from "../../shared/logger"
import type { AgentFrontmatter, ClaudeCodeAgentConfig } from "../claude-code-agent-loader/types"
import { mapClaudeModelToOpenCode } from "../claude-code-agent-loader/claude-model-mapper"
import type { LoadedPlugin } from "./types"

function parseToolsConfig(toolsStr?: string): Record<string, boolean> | undefined {
  if (!toolsStr) return undefined

  const tools = toolsStr
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean)

  if (tools.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of tools) {
    result[tool.toLowerCase()] = true
  }
  return result
}

export function loadPluginAgents(plugins: LoadedPlugin[]): Record<string, ClaudeCodeAgentConfig> {
  const agents: Record<string, ClaudeCodeAgentConfig> = {}

  for (const plugin of plugins) {
    if (!plugin.agentsDir || !existsSync(plugin.agentsDir)) continue

    const entries = readdirSync(plugin.agentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!isMarkdownFile(entry)) continue

      const agentPath = join(plugin.agentsDir, entry.name)
      const agentName = basename(entry.name, ".md")
      const namespacedName = `${plugin.name}:${agentName}`

      try {
        const content = readFileSync(agentPath, "utf-8")
        const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

        const originalDescription = data.description || ""
        const formattedDescription = `(plugin: ${plugin.name}) ${originalDescription}`

        const mappedModelOverride = mapClaudeModelToOpenCode(data.model)

        const config: ClaudeCodeAgentConfig = {
          description: formattedDescription,
          mode: "subagent",
          prompt: body.trim(),
          ...(mappedModelOverride ? { model: mappedModelOverride } : {}),
        }

        const toolsConfig = parseToolsConfig(data.tools)
        if (toolsConfig) {
          config.tools = toolsConfig
        }

        agents[namespacedName] = config
        log(`Loaded plugin agent: ${namespacedName}`, { path: agentPath })
      } catch (error) {
        log(`Failed to load plugin agent: ${agentPath}`, error)
      }
    }
  }

  return agents
}
