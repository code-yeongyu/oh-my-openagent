import { existsSync, readFileSync } from "fs"
import { basename, extname } from "path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { log } from "../../shared/logger"
import { parseToolsConfig } from "../../shared/parse-tools-config"
import { parseJsonAgentFile } from "./json-agent-loader"
import { mapClaudeModelToOpenCode } from "./claude-model-mapper"
import type { AgentScope, AgentFrontmatter, ClaudeCodeAgentConfig, LoadedAgent } from "./types"

export function parseMarkdownAgentFile(filePath: string, scope: AgentScope): LoadedAgent | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

    const fileName = basename(filePath)
    const agentName = fileName.replace(/\.md$/i, "")
    const name = data.name || agentName
    const originalDescription = data.description || ""

    const formattedDescription = `(${scope}) ${originalDescription}`

    const mappedModelOverride = mapClaudeModelToOpenCode(data.model)
    const modelString = mappedModelOverride
      ? `${mappedModelOverride.providerID}/${mappedModelOverride.modelID}`
      : undefined

    const config: ClaudeCodeAgentConfig = {
      description: formattedDescription,
      mode: data.mode || "subagent",
      prompt: body.trim(),
      ...(modelString ? { model: modelString } : {}),
    }

    const toolsConfig = parseToolsConfig(data.tools)
    if (toolsConfig) {
      config.tools = toolsConfig
    }

    return {
      name,
      path: filePath,
      config,
      scope,
    }
  } catch {
    return null
  }
}

export function loadAgentDefinitions(
  paths: string[],
  scope: AgentScope
): Record<string, ClaudeCodeAgentConfig> {
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)

  for (const filePath of paths) {
    if (!existsSync(filePath)) {
      log(`[agent-definitions-loader] File not found, skipping: ${filePath}`)
      continue
    }

    const ext = extname(filePath).toLowerCase()
    let agent: LoadedAgent | null = null

    if (ext === ".md") {
      agent = parseMarkdownAgentFile(filePath, scope)
    } else if (ext === ".json" || ext === ".jsonc") {
      agent = parseJsonAgentFile(filePath, scope)
    } else {
      log(`[agent-definitions-loader] Unsupported file extension: ${ext} for ${filePath}`)
      continue
    }

    if (!agent) {
      log(`[agent-definitions-loader] Failed to parse agent file: ${filePath}`)
      continue
    }

    result[agent.name] = agent.config
  }

  return result
}
