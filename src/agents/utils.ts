import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentName, AgentOverrideConfig, AgentOverrides } from "./types"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"

const allBuiltinAgents: Record<AgentName, AgentConfig> = {
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
}

function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig
): AgentConfig {
  return {
    ...base,
    ...override,
    tools: override.tools !== undefined
      ? { ...(base.tools ?? {}), ...override.tools }
      : base.tools,
    permission: override.permission !== undefined
      ? { ...(base.permission ?? {}), ...override.permission }
      : base.permission,
  }
}

export function createBuiltinAgents(
  disabledAgents: AgentName[] = [],
  agentOverrides: AgentOverrides = {}
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}

  for (const [name, config] of Object.entries(allBuiltinAgents)) {
    const agentName = name as AgentName

    if (disabledAgents.includes(agentName)) {
      continue
    }

    const override = agentOverrides[agentName]
    if (override) {
      result[name] = mergeAgentConfig(config, override)
    } else {
      result[name] = config
    }
  }

  return result
}
