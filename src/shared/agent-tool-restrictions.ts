const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
  call_omo_agent: false,
}

const BUILTIN_AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
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

  "sisyphus-junior": {
    task: false,
    delegate_task: false,
  },
}

const customAgentRestrictions: Record<string, Record<string, boolean>> = {}

export function registerCustomAgentRestrictions(
  agentName: string,
  restrictions: Record<string, boolean>
): void {
  customAgentRestrictions[agentName] = restrictions
}

function getAllRestrictions(): Record<string, Record<string, boolean>> {
  return { ...BUILTIN_AGENT_RESTRICTIONS, ...customAgentRestrictions }
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  const all = getAllRestrictions()
  return all[agentName]
    ?? Object.entries(all).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const all = getAllRestrictions()
  const restrictions = all[agentName]
    ?? Object.entries(all).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
  return restrictions !== undefined && Object.keys(restrictions).length > 0
}
