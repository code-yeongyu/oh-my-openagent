/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

import { createAgentToolRestrictions } from "./permission-compat"

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

const ATHENA_RESTRICTIONS = permissionToToolBooleans(
  createAgentToolRestrictions(["write", "edit"]).permission
)

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },

  metis: {
    write: false,
    edit: false,
    task: false,
  },

  momus: {
    write: false,
    edit: false,
    task: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },

  athena: ATHENA_RESTRICTIONS,

  "council-member": {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
    athena_council: false,
  },
}

function permissionToToolBooleans(
  permission: Record<string, "ask" | "allow" | "deny">
): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(permission).map(([tool, value]) => [tool, value === "allow"])
  )
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
  return restrictions !== undefined && Object.keys(restrictions).length > 0
}
