import { existsSync, readdirSync, readFileSync } from "fs"
import { join, resolve } from "path"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { log } from "../../shared/logger"
import type { AgentScope, ClaudeCodeAgentConfig, LoadedAgent } from "./types"
import { getOpenCodeConfigDirs } from "../../shared/opencode-config-dir"
import { parseMarkdownAgentFile } from "./agent-definitions-loader"

/**
 * Stamp the OpenCode v2 host writes into the frontmatter of every agent file it materialises
 * (omo-opencode/src/v2/agent-markdown.ts). A stamped file is this plugin's own output, not an
 * agent source: loading it feeds the previous boot's result into the next one, so the
 * description gains one "(opencode) " prefix per boot and the file is rewritten forever.
 */
const PLUGIN_GENERATED_AGENT_STAMP = "# generated-by: oh-my-openagent"

export function isPluginGeneratedAgentFile(agentPath: string): boolean {
  try {
    const content = readFileSync(agentPath, "utf-8")
    if (!content.startsWith("---")) return false
    const frontmatterEnd = content.indexOf("\n---", 3)
    const frontmatter = frontmatterEnd === -1 ? content : content.slice(0, frontmatterEnd)
    return frontmatter.split(/\r?\n/).some((line) => line.trim() === PLUGIN_GENERATED_AGENT_STAMP)
  } catch {
    return false
  }
}

function isSameDirectory(left: string, right: string): boolean {
  const resolvedLeft = resolve(left)
  const resolvedRight = resolve(right)
  if (process.platform === "win32") return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
  return resolvedLeft === resolvedRight
}

function loadAgentsFromDir(agentsDir: string, scope: AgentScope, anthropicProvider?: string): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  const agents: LoadedAgent[] = []
  let skippedGenerated = 0

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    if (isPluginGeneratedAgentFile(agentPath)) {
      skippedGenerated += 1
      continue
    }

    const agent = parseMarkdownAgentFile(agentPath, scope, anthropicProvider)

    if (agent) {
      agents.push(agent)
    }
  }

  if (skippedGenerated > 0) {
    log("[agent-loader] skipped plugin-generated agent files", { agentsDir, scope, count: skippedGenerated })
  }

  return agents
}

export function loadUserAgents(anthropicProvider?: string): Record<string, ClaudeCodeAgentConfig> {
  const userAgentsDir = join(getClaudeConfigDir(), "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user", anthropicProvider)

  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadProjectAgents(directory?: string, anthropicProvider?: string): Record<string, ClaudeCodeAgentConfig> {
  const projectAgentsDir = join(directory ?? process.cwd(), ".claude", "agents")
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)

  // With the home directory as the project, <directory>/.claude/agents IS the user agents dir.
  // loadUserAgents already owns it; loading it again relabels every user agent as "(project)"
  // depending on where the session was opened.
  if (isSameDirectory(projectAgentsDir, join(getClaudeConfigDir(), "agents"))) {
    log("[agent-loader] project agents dir is the user agents dir; not loading it twice", { projectAgentsDir })
    return result
  }

  const agents = loadAgentsFromDir(projectAgentsDir, "project", anthropicProvider)

  for (const agent of agents) {
    result[agent.name] = agent.config
  }
  return result
}

export function loadOpencodeGlobalAgents(): Record<string, ClaudeCodeAgentConfig> {
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  const configDirs = getOpenCodeConfigDirs({ binary: "opencode" })

  for (const configDir of configDirs) {
    const opencodeAgentsDir = join(configDir, "agents")
    const agents = loadAgentsFromDir(opencodeAgentsDir, "opencode")

    for (const agent of agents) {
      if (!(agent.name in result)) {
        result[agent.name] = agent.config
      }
    }
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
