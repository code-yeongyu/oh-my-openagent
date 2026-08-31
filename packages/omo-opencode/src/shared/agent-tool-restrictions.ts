import { stripInvisibleAgentCharacters } from "./agent-display-names"
import type { PermissionValue } from "./permission-compat"

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

export type AgentSpawnUserPermission = Record<string, PermissionValue | boolean>

type AgentSpawnToolsOptions = AgentToolRestrictionsOptions & {
  allowTask?: boolean
}

const HARNESS_PINNED_TOOLS = ["question"] as const

/**
 * Builds the `tools` map for a delegated subagent session prompt.
 *
 * Merge order (issue #6877): operational defaults, then the agent's fixed
 * restriction table, then explicit user permission entries LAST so a user
 * grant (`"allow"` / `true`) punches through the restricted baseline and a
 * user deny stays denied. `task` keeps its caller-supplied operational value
 * unless the user explicitly denies it, and `question` always stays false,
 * matching the #5182/#5193 contract where hardcoded delegation-loop guards win.
 */
export function buildAgentSpawnTools(
  agentName: string,
  userPermission?: AgentSpawnUserPermission,
  options: AgentSpawnToolsOptions = {},
): Record<string, boolean> {
  const operationalTask = options.allowTask ?? false
  const tools: Record<string, boolean> = {
    task: operationalTask,
    call_omo_agent: true,
    question: false,
    ...getAgentToolRestrictions(agentName, options),
  }

  let userDeniedTask = false
  if (userPermission) {
    for (const [tool, value] of Object.entries(userPermission)) {
      const permission: PermissionValue | undefined = typeof value === "boolean"
        ? (value ? "allow" : "deny")
        : value
      if (permission === "allow") tools[tool] = true
      if (permission === "deny") {
        tools[tool] = false
        if (tool === "task") userDeniedTask = true
      }
    }
  }

  tools.task = userDeniedTask ? false : operationalTask
  for (const tool of HARNESS_PINNED_TOOLS) {
    tools[tool] = false
  }

  return tools
}
