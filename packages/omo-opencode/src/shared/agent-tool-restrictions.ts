import type { SpawnCallerRole } from "@oh-my-opencode/delegate-core"

import { getAgentConfigKey, type AgentDisplayOverrides } from "./agent-display-names"

const TEAM_TOOL_DENYLIST: Record<string, false> = {
  team_create: false, team_delete: false, team_shutdown_request: false, team_approve_shutdown: false,
  team_reject_shutdown: false, team_send_message: false, team_task_create: false, team_task_list: false,
  team_task_update: false, team_task_get: false, team_status: false, team_list: false,
}
const LOOK_AT_DENYLIST: Record<string, false> = { look_at: false }
const SPAWN_TOOL_DENYLIST: Record<string, false> = {
  task: false, call_omo_agent: false, ...LOOK_AT_DENYLIST,
}

export type AgentSpawnPolicy = {
  readonly callerRole: SpawnCallerRole
  readonly allowedSubagents?: readonly string[]
}
export type AgentSpawnPolicyInput = {
  readonly agentName: string
  readonly agentOverrides?: AgentDisplayOverrides
  readonly teamSessionRole?: string
}
export type AgentToolRestrictionsOptions = {
  readonly agentOverrides?: AgentDisplayOverrides
  readonly includeTeamToolDenylist?: boolean
  readonly teamSessionRole?: string
}

const coordinatorPolicy = { callerRole: "coordinator" } as const satisfies AgentSpawnPolicy
const planningPolicy = {
  callerRole: "planning_coordinator",
  allowedSubagents: ["explore", "librarian"],
} as const satisfies AgentSpawnPolicy
const teamMemberPolicy = { callerRole: "team_member" } as const satisfies AgentSpawnPolicy
const leafPolicy = { callerRole: "leaf" } as const satisfies AgentSpawnPolicy
const agentSpawnPolicies: Readonly<Record<string, AgentSpawnPolicy>> = {
  sisyphus: coordinatorPolicy,
  atlas: coordinatorPolicy,
  plan: planningPolicy,
  prometheus: planningPolicy,
  hephaestus: { callerRole: "worker" },
  "sisyphus-junior": { callerRole: "worker" },
  momus: { callerRole: "reviewer" },
  oracle: { callerRole: "reviewer" },
  metis: { callerRole: "specialist" },
  librarian: { callerRole: "specialist" },
  explore: { callerRole: "specialist" },
  "multimodal-looker": { callerRole: "specialist" },
}
const spawnToolRestrictions = {
  coordinator: {},
  planning_coordinator: { team_create: false, ...LOOK_AT_DENYLIST },
  worker: SPAWN_TOOL_DENYLIST,
  reviewer: SPAWN_TOOL_DENYLIST,
  specialist: SPAWN_TOOL_DENYLIST,
  team_member: SPAWN_TOOL_DENYLIST,
  leaf: SPAWN_TOOL_DENYLIST,
} as const satisfies Record<SpawnCallerRole, Record<string, false>>

const explorationRestrictions: Record<string, boolean> = {
  write: false, edit: false, task: false, call_omo_agent: false,
}
const agentRestrictions: Record<string, Record<string, boolean>> = {
  explore: explorationRestrictions,
  librarian: explorationRestrictions,
  oracle: explorationRestrictions,
  metis: { write: false, edit: false },
  momus: { write: false, edit: false },
  "multimodal-looker": { read: true },
  "sisyphus-junior": { task: false },
}

export function getAgentSpawnPolicy(input: AgentSpawnPolicyInput): AgentSpawnPolicy {
  switch (input.teamSessionRole) {
    case undefined:
    case "lead":
      return agentSpawnPolicies[getAgentConfigKey(input.agentName, input.agentOverrides)] ?? leafPolicy
    case "member":
      return teamMemberPolicy
    default:
      return leafPolicy
  }
}

export function getAgentSpawnToolRestrictions(input: AgentSpawnPolicyInput): Record<string, false> {
  return { ...spawnToolRestrictions[getAgentSpawnPolicy(input).callerRole] }
}

export function getAgentToolRestrictions(
  agentName: string,
  options: AgentToolRestrictionsOptions = {},
): Record<string, boolean> {
  const agentKey = getAgentConfigKey(agentName, options.agentOverrides)
  return {
    ...(options.includeTeamToolDenylist === false ? {} : TEAM_TOOL_DENYLIST),
    ...(agentRestrictions[agentKey] ?? {}),
    ...getAgentSpawnToolRestrictions({
      agentName,
      agentOverrides: options.agentOverrides,
      teamSessionRole: options.teamSessionRole,
    }),
  }
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  return Object.keys(getAgentToolRestrictions(agentName)).length > 0
}
