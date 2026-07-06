import { defineAgent } from "./schema"
import type { AgentDefinition, AgentDefinitionInput } from "./types"

const registeredAgents = new Map<string, AgentDefinition>()

export function registerAgent(input: AgentDefinitionInput): AgentDefinition {
  const definition = defineAgent(input)
  registeredAgents.set(definition.name, definition)
  return definition
}

export function registeredAgentDefinitions(): readonly AgentDefinition[] {
  return [...registeredAgents.values()]
}

export function clearRegisteredAgentsForTests(): void {
  registeredAgents.clear()
}
