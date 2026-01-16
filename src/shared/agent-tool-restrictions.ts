/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
  call_omo_agent: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    delegate_task: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "document-writer": {
    task: false,
    delegate_task: false,
    call_omo_agent: false,
  },

  "frontend-ui-ux-engineer": {
    task: false,
    delegate_task: false,
    call_omo_agent: false,
  },

  "Sisyphus-Junior": {
    task: false,
    delegate_task: false,
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName] ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = AGENT_RESTRICTIONS[agentName]
  return restrictions !== undefined && Object.keys(restrictions).length > 0
}
