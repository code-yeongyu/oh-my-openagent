import * as fs from "node:fs"
import * as path from "node:path"

import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { parseToolsConfig } from "../../shared/parse-tools-config"
import { resolveAgentDefinitionPaths } from "../../shared/resolve-agent-definition-paths"
import { loadAgentDefinitions } from "./agent-definitions-loader"
import { mapClaudeModelToOpenCode } from "./claude-model-mapper"
import type { ClaudeCodeAgentConfig } from "./types"

interface OpencodeConfigWithAgents {
  agents?: Record<string, unknown>
  agent?: Record<string, unknown>
  agent_definitions?: string | string[]
}

function getConfigPaths(directory: string): string[] {
  const globalConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(globalConfigDir, "opencode.json"),
    path.join(globalConfigDir, "opencode.jsonc"),
  ]

  return paths
}

function convertInlineAgent(agentData: unknown): ClaudeCodeAgentConfig | null {
  if (!agentData || typeof agentData !== "object") {
    return null
  }

  const agent = agentData as Record<string, unknown>

  const description = agent.description ? `(opencode-config) ${String(agent.description)}` : "(opencode-config) "

  const mappedModel = mapClaudeModelToOpenCode(
    agent.model ? String(agent.model) : undefined
  )
  const modelString = mappedModel
    ? `${mappedModel.providerID}/${mappedModel.modelID}`
    : undefined

  const VALID_MODES = ["subagent", "primary", "all"] as const
  const rawMode = typeof agent.mode === "string" ? agent.mode : undefined
  const mode = rawMode && (VALID_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as "subagent" | "primary" | "all")
    : "subagent"

  const config: ClaudeCodeAgentConfig = {
    description,
    mode,
    prompt: agent.prompt ? String(agent.prompt) : "",
    ...(modelString ? { model: modelString } : {}),
  }

  const toolsConfig = parseToolsConfig(agent.tools)
  if (toolsConfig) {
    config.tools = toolsConfig
  }

  return config
}

export function readOpencodeConfigAgents(directory: string): Record<string, ClaudeCodeAgentConfig> {
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)

  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue

      const content = fs.readFileSync(configPath, "utf-8")
      const parseResult = parseJsoncSafe<OpencodeConfigWithAgents>(content)

      if (!parseResult.data) continue

      const configDir = path.dirname(configPath)

      const agentsToLoad = parseResult.data.agents || parseResult.data.agent

      if (agentsToLoad && typeof agentsToLoad === "object") {
        for (const [agentName, agentData] of Object.entries(agentsToLoad)) {
          if (Object.hasOwn(result, agentName)) continue
          const converted = convertInlineAgent(agentData)
          if (converted) {
            result[agentName] = converted
          }
        }
      }

      if (parseResult.data.agent_definitions) {
        const definitionPaths = extractDefinitionPaths(parseResult.data.agent_definitions)
        const resolvedPaths = resolveAgentDefinitionPaths(definitionPaths, configDir, directory)

        const definitionAgents = loadAgentDefinitions(resolvedPaths, "opencode-config")

        for (const [name, config] of Object.entries(definitionAgents)) {
          if (!Object.hasOwn(result, name)) {
            result[name] = config
          }
        }
      }
    } catch {
      continue
    }
  }

  return result
}

function extractDefinitionPaths(definitionPaths: unknown): string[] {
  if (typeof definitionPaths === "string") {
    return [definitionPaths]
  }

  if (Array.isArray(definitionPaths)) {
    return definitionPaths
      .filter((p) => typeof p === "string")
      .map((p) => p as string)
  }

  return []
}
