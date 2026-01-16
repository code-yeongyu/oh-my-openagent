import type { PermissionValue } from "./permission-compat"

/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter OVERRIDES agent-level permissions.
 * This provides complete restriction sets so session.prompt calls include all necessary restrictions.
 */

const EXPLORATION_AGENT_DENYLIST: Record<string, PermissionValue> = {
  write: "deny",
  edit: "deny",
  task: "deny",
  delegate_task: "deny",
  call_omo_agent: "deny",
}

const AGENT_RESTRICTIONS: Record<string, Record<string, PermissionValue>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: "deny",
    edit: "deny",
    task: "deny",
    delegate_task: "deny",
  },

  "multimodal-looker": {
    "*": "deny",
    read: "allow",
  },

  "document-writer": {
    task: "deny",
    delegate_task: "deny",
    call_omo_agent: "deny",
  },

  "frontend-ui-ux-engineer": {
    task: "deny",
    delegate_task: "deny",
    call_omo_agent: "deny",
  },

  "Sisyphus-Junior": {
    task: "deny",
    delegate_task: "deny",
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, PermissionValue> {
  return AGENT_RESTRICTIONS[agentName] ?? {}
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = AGENT_RESTRICTIONS[agentName]
  return restrictions !== undefined && Object.keys(restrictions).length > 0
}
