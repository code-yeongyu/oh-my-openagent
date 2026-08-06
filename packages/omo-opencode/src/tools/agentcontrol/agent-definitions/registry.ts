import { DISPATCH_DEFINITION } from "./dispatch"
import { EXECUTE_DEFINITION } from "./execute"
import { EXPLORE_DEFINITION } from "./explore"
import { PLAN_DEFINITION } from "./plan"
import { RESEARCH_DEFINITION } from "./research"
import { AGENT_CONTROL_KINDS, type AgentControlDefinition, type AgentControlKind } from "./types"

export const AGENT_CONTROL_DEFINITIONS: Record<AgentControlKind, AgentControlDefinition> = {
  execute: EXECUTE_DEFINITION,
  explore: EXPLORE_DEFINITION,
  plan: PLAN_DEFINITION,
  research: RESEARCH_DEFINITION,
  dispatch: DISPATCH_DEFINITION,
}

export function isAgentControlKind(value: string | undefined): value is AgentControlKind {
  return AGENT_CONTROL_KINDS.some((kind) => kind === value)
}

export function getAgentControlDefinition(kind: AgentControlKind): AgentControlDefinition {
  return AGENT_CONTROL_DEFINITIONS[kind]
}

export function getSelectedAgentControlDefinition(): AgentControlDefinition | undefined {
  const value = process.env.AGENT_CONTROL_KIND?.trim()
  return isAgentControlKind(value) ? getAgentControlDefinition(value) : undefined
}
