import { stripInvisibleAgentCharacters } from "./agent-display-names"

/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const TEAM_TOOL_DENYLIST: Record<string, boolean> = {
  team_create: false,
  team_delete: false,
  team_shutdown_request: false,
  team_approve_shutdown: false,
  team_reject_shutdown: false,
  team_send_message: false,
  team_task_create: false,
  team_task_list: false,
  team_task_update: false,
  team_task_get: false,
  team_status: false,
  team_list: false,
}

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

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
  },

  momus: {
    write: false,
    edit: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },
}

type AgentToolRestrictionsOptions = {
  includeTeamToolDenylist?: boolean
}

export function getAgentToolRestrictions(agentName: string, options: AgentToolRestrictionsOptions = {}): Record<string, boolean> {
  const stripped = stripInvisibleAgentCharacters(agentName)
  const agentRestrictions = AGENT_RESTRICTIONS[stripped]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1]
    ?? {}

  return {
    ...(options.includeTeamToolDenylist === false ? {} : TEAM_TOOL_DENYLIST),
    ...agentRestrictions,
  }
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = getAgentToolRestrictions(agentName)
  return Object.keys(restrictions).length > 0
}
