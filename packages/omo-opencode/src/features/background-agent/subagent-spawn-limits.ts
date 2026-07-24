import {
  decideSpawnAdmission,
  type SpawnPolicyDecision,
  type SpawnPolicyInput,
} from "@oh-my-opencode/delegate-core"
import type { AgentOverrides, BackgroundTaskConfig } from "../../config/schema"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { getAgentSpawnPolicy } from "../../shared/agent-tool-restrictions"
import { findResolvedMemberSession } from "../team-mode/member-session-resolution"
import { lookupTeamSession } from "../team-mode/team-session-registry"
import type { OpencodeClient } from "./constants"

export type SpawnAdmissionRequest = {
  readonly parentSessionID: string
  readonly parentAgent: string
  readonly targetAgent: string
}

export type SubagentSpawnContext = {
  readonly rootSessionID: string
  readonly parentDepth: number
  readonly childDepth: number
  readonly decision: Extract<SpawnPolicyDecision, { readonly allowed: true }>
}

type LineageDiscovery = {
  readonly lineage: "known" | "unknown" | "cyclic"
  readonly currentDepth: number
  readonly rootSessionID: string
}

export class OpenCodeSpawnAdmissionError extends Error {
  readonly name = "OpenCodeSpawnAdmissionError"

  constructor(
    readonly decision: Extract<SpawnPolicyDecision, { readonly allowed: false }>,
    readonly request: SpawnAdmissionRequest,
  ) {
    super(`Subagent spawn denied: ${decision.reason}`)
  }
}

export class MissingSpawnCallerIdentityError extends Error {
  readonly name = "MissingSpawnCallerIdentityError"

  constructor() {
    super("Subagent spawn denied: trusted caller identity is required")
  }
}

export function requireSpawnCallerIdentity(parentAgent: string | undefined): string {
  const trustedParentAgent = parentAgent?.trim()
  if (!trustedParentAgent) throw new MissingSpawnCallerIdentityError()
  return trustedParentAgent
}

function resolveAgentOverride(agentOverrides: AgentOverrides | undefined, agentName: string) {
  if (!agentOverrides) return undefined
  const agentKey = getAgentConfigKey(agentName, agentOverrides)
  return agentOverrides[agentKey]
    ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentKey)?.[1]
}

function intersectAllowedTargets(
  roleTargets: readonly string[] | undefined,
  overrideTargets: readonly string[] | undefined,
  agentOverrides: AgentOverrides | undefined,
): readonly string[] | undefined {
  const normalizedRoleTargets = roleTargets?.map((target) => getAgentConfigKey(target, agentOverrides))
  const normalizedOverrideTargets = overrideTargets?.map((target) => getAgentConfigKey(target, agentOverrides))
  if (!normalizedRoleTargets) return normalizedOverrideTargets
  if (!normalizedOverrideTargets) return normalizedRoleTargets
  const overrideSet = new Set(normalizedOverrideTargets)
  return normalizedRoleTargets.filter((target) => overrideSet.has(target))
}

export async function discoverSubagentLineage(
  client: OpencodeClient,
  parentSessionID: string,
  directory?: string,
): Promise<LineageDiscovery> {
  const visitedSessionIDs = new Set<string>()
  let currentSessionID = parentSessionID
  let currentDepth = 0

  while (true) {
    if (visitedSessionIDs.has(currentSessionID)) return { lineage: "cyclic", currentDepth, rootSessionID: parentSessionID }
    visitedSessionIDs.add(currentSessionID)

    try {
      const response = await client.session.get({
        path: { id: currentSessionID },
        ...(directory ? { query: { directory } } : {}),
      })
      if (response.error || !response.data) return { lineage: "unknown", currentDepth, rootSessionID: parentSessionID }
      if (!response.data.parentID) return { lineage: "known", currentDepth, rootSessionID: currentSessionID }
      currentSessionID = response.data.parentID
      currentDepth += 1
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { lineage: "unknown", currentDepth, rootSessionID: parentSessionID }
    }
  }
}

export async function decideOpenCodeSpawnAdmission(input: {
  readonly client: OpencodeClient
  readonly directory?: string
  readonly config?: BackgroundTaskConfig
  readonly agentOverrides?: AgentOverrides
  readonly teamModeConfig?: TeamModeConfig
  readonly request: SpawnAdmissionRequest
}): Promise<{ readonly decision: SpawnPolicyDecision; readonly lineage: LineageDiscovery }> {
  const lineage = await discoverSubagentLineage(input.client, input.request.parentSessionID, input.directory)
  const registeredRole = lookupTeamSession(input.request.parentSessionID)?.role
  const persistedMember = registeredRole === undefined && input.teamModeConfig?.enabled
    ? await findResolvedMemberSession(input.request.parentSessionID, input.teamModeConfig, "spawn admission")
    : null
  const teamSessionRole = registeredRole ?? (persistedMember === null ? undefined : "member")
  const rolePolicy = getAgentSpawnPolicy({
    agentName: input.request.parentAgent,
    agentOverrides: input.agentOverrides,
    ...(teamSessionRole ? { teamSessionRole } : {}),
  })
  const agentOverride = resolveAgentOverride(input.agentOverrides, input.request.parentAgent)
  const policyInput = {
    currentDepth: lineage.currentDepth,
    lineage: lineage.lineage,
    callerRole: rolePolicy.callerRole,
    targetAgent: getAgentConfigKey(input.request.targetAgent, input.agentOverrides),
    configuredMaxDepth: input.config?.maxDepth,
    callerMaxDepth: agentOverride?.maxDepth,
    allowedSubagents: intersectAllowedTargets(rolePolicy.allowedSubagents, agentOverride?.allowedSubagents, input.agentOverrides),
  } satisfies SpawnPolicyInput
  return { decision: decideSpawnAdmission(policyInput), lineage }
}

export async function assertOpenCodeSpawnAdmission(input: Parameters<typeof decideOpenCodeSpawnAdmission>[0]): Promise<SubagentSpawnContext> {
  const result = await decideOpenCodeSpawnAdmission(input)
  if (!result.decision.allowed) throw new OpenCodeSpawnAdmissionError(result.decision, input.request)
  return {
    rootSessionID: result.lineage.rootSessionID,
    parentDepth: result.lineage.currentDepth,
    childDepth: result.decision.childDepth,
    decision: result.decision,
  }
}
