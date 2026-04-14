import { existsSync, readFileSync } from "fs"
import { parseJsoncSafe } from "../../shared/jsonc-parser"
import { mapClaudeModelToOpenCode } from "./claude-model-mapper"
import type { AgentScope, AgentJsonDefinition, ClaudeCodeAgentConfig, LoadedAgent } from "./types"

function parseToolsConfig(tools?: string | string[]): Record<string, boolean> | undefined {
  if (!tools) return undefined

  const toolsArray = Array.isArray(tools) ? tools : tools.split(",").map((t) => t.trim())
  const filtered = toolsArray.filter((t) => typeof t === "string" && t.length > 0)

  if (filtered.length === 0) return undefined

  const result: Record<string, boolean> = {}
  for (const tool of filtered) {
    result[tool.toLowerCase()] = true
  }
  return result
}

export function parseJsonAgentFile(filePath: string, scope: AgentScope): LoadedAgent | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const { data } = parseJsoncSafe<AgentJsonDefinition>(content)

    if (!data) {
      return null
    }

    if (!data.name || !data.prompt) {
      return null
    }

    const originalDescription = data.description ?? ""
    const formattedDescription = `(${scope}) ${originalDescription}`

    const mappedModelOverride = mapClaudeModelToOpenCode(data.model)
    const modelString = mappedModelOverride
      ? `${mappedModelOverride.providerID}/${mappedModelOverride.modelID}`
      : undefined

    const config: ClaudeCodeAgentConfig = {
      description: formattedDescription,
      mode: data.mode ?? "subagent",
      prompt: data.prompt.trim(),
      ...(modelString ? { model: modelString } : {}),
    }

    const toolsConfig = parseToolsConfig(data.tools)
    if (toolsConfig) {
      config.tools = toolsConfig
    }

    return {
      name: data.name,
      path: filePath,
      config,
      scope,
    }
  } catch {
    return null
  }
}
