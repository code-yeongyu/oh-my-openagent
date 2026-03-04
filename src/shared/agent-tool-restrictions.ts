/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

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

/**
 * Build the tools restriction object for a subagent.
 *
 * - Gets base restrictions from AGENT_RESTRICTIONS via getAgentToolRestrictions().
 * - If restrictions already define `task`, uses that value (built-in agents stay restricted).
 * - If restrictions do NOT define `task` (custom/unknown agents), defaults to `task: true` (allow).
 * - Always sets `call_omo_agent: true` and `question: false`.
 */
export function buildSubagentTools(agentName: string): Record<string, boolean> {
  const restrictions = getAgentToolRestrictions(agentName)
  return {
    ...restrictions,
    ...("task" in restrictions ? {} : { task: true }),
    call_omo_agent: true,
    question: false,
  }
}
