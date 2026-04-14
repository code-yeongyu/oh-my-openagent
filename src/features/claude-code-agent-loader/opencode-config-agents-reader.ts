import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { loadAgentDefinitions } from "./agent-definitions-loader"
import { mapClaudeModelToOpenCode } from "./claude-model-mapper"
import type { ClaudeCodeAgentConfig } from "./types"

interface OpencodeConfigWithAgents {
  agents?: Record<string, unknown>
  agent_definitions?: string | string[]
}

function getWindowsAppdataDir(): string | null {
  return process.env.APPDATA || null
}

function getConfigPaths(directory: string): string[] {
  const crossPlatformDir = path.join(os.homedir(), ".config")
  const paths = [
    path.join(directory, ".opencode", "opencode.json"),
    path.join(directory, ".opencode", "opencode.jsonc"),
    path.join(crossPlatformDir, "opencode", "opencode.json"),
    path.join(crossPlatformDir, "opencode", "opencode.jsonc"),
  ]

  if (process.platform === "win32") {
    const appdataDir = getWindowsAppdataDir()
    if (appdataDir) {
      paths.push(path.join(appdataDir, "opencode", "opencode.json"))
      paths.push(path.join(appdataDir, "opencode", "opencode.jsonc"))
    }
  }

  return paths
}

function parseToolsConfig(toolsValue: unknown): Record<string, boolean> | undefined {
  if (!toolsValue) return undefined

  let toolsStr: string
  if (typeof toolsValue === "string") {
    toolsStr = toolsValue
  } else if (Array.isArray(toolsValue)) {
    toolsStr = toolsValue.filter((t) => typeof t === "string").join(",")
  } else {
    return undefined
  }

  const tools = toolsStr.split(",").map((t) => t.trim()).filter(Boolean)
  if (tools.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of tools) {
    result[tool.toLowerCase()] = true
  }
  return result
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

  const config: ClaudeCodeAgentConfig = {
    description,
    mode: (agent.mode as "subagent" | "primary" | "all") || "subagent",
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
  const result: Record<string, ClaudeCodeAgentConfig> = {}

  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue

      const content = fs.readFileSync(configPath, "utf-8")
      const parseResult = parseJsoncSafe<OpencodeConfigWithAgents>(content)

      if (!parseResult.data) continue

      const configDir = path.dirname(configPath)

      if (parseResult.data.agents && typeof parseResult.data.agents === "object") {
        for (const [agentName, agentData] of Object.entries(parseResult.data.agents)) {
          const converted = convertInlineAgent(agentData)
          if (converted) {
            result[agentName] = converted
          }
        }
      }

      if (parseResult.data.agent_definitions) {
        const definitionPaths = extractDefinitionPaths(parseResult.data.agent_definitions)
        const resolvedPaths = definitionPaths.map((p) =>
          path.isAbsolute(p) ? p : path.resolve(configDir, p)
        )

        const definitionAgents = loadAgentDefinitions(resolvedPaths, "opencode-config")

        for (const [name, config] of Object.entries(definitionAgents)) {
          if (!(name in result)) {
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
