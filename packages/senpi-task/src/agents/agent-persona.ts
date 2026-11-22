import { agentToolPolicy } from "./agent-tool-policy"
import type { AgentDefinition } from "./types"
import type { AgentPersona } from "./resolve-agent"

export function agentPersona(name: string, definition: AgentDefinition): AgentPersona {
  const agentExecutionMode = toExecutionMode(definition.executionMode)
  return {
    agentType: name,
    ...(definition.prompt !== undefined ? { instructions: definition.prompt } : {}),
    ...agentToolPolicy(definition),
    ...(agentExecutionMode !== undefined ? { agentExecutionMode } : {}),
    ...(definition.allowedSubagents !== undefined ? { allowedSubagents: definition.allowedSubagents } : {}),
    ...(definition.maxDepth !== undefined ? { maxDepth: definition.maxDepth } : {}),
  }
}

function toExecutionMode(value: string | undefined): AgentPersona["agentExecutionMode"] {
  switch (value) {
    case "in-process":
    case "process":
      return value
    default:
      return undefined
  }
}
