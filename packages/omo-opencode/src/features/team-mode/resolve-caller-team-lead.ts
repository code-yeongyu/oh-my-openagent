import { getAgentConfigKey, getAgentDisplayName, stripAgentListSortPrefix } from "../../shared/agent-display-names"

import { AGENT_ELIGIBILITY_REGISTRY, type TeamSpec } from "./types"
import type { FinalOpenCodeAgent } from "./final-open-code-agent-registry"

export type CallerTeamLead = {
  agentTypeId?: string
  displayName?: string
  isEligibleForTeamLead: boolean
}

type AgentOverrides = Record<string, { readonly displayName?: string } | undefined>

function resolveConfiguredAgentKey(agentName: string, overrides?: AgentOverrides): string {
  const normalizedName = stripAgentListSortPrefix(agentName).trim().toLowerCase()
  const configuredEntry = Object.entries(overrides ?? {}).find(([, override]) => (
    override?.displayName?.trim().toLowerCase() === normalizedName
  ))
  return configuredEntry?.[0] ?? getAgentConfigKey(agentName)
}

export function resolveCallerTeamLead(
  rawAgentName: string | undefined,
  finalRegistry: readonly Pick<FinalOpenCodeAgent, "name">[] = [],
  overrides?: AgentOverrides,
): CallerTeamLead {
  if (typeof rawAgentName !== "string") {
    return { isEligibleForTeamLead: false }
  }

  const strippedDisplayName = stripAgentListSortPrefix(rawAgentName).trim()
  if (!strippedDisplayName) {
    return { isEligibleForTeamLead: false }
  }

  const requestedAgentTypeId = resolveConfiguredAgentKey(strippedDisplayName, overrides)
  const eligibility = AGENT_ELIGIBILITY_REGISTRY[requestedAgentTypeId]
  if (!eligibility || eligibility.verdict === "hard-reject") {
    return { displayName: strippedDisplayName, isEligibleForTeamLead: false }
  }

  const protectedDisplayIdentity = getAgentDisplayName(requestedAgentTypeId, overrides)
  const protectedRegistryEntries = finalRegistry.filter((candidate) => (
    stripAgentListSortPrefix(candidate.name).trim().toLowerCase() === protectedDisplayIdentity.trim().toLowerCase()
  ))
  if (protectedRegistryEntries.length !== 1) {
    return { displayName: strippedDisplayName, isEligibleForTeamLead: false }
  }

  const agentTypeId = requestedAgentTypeId
  const canonicalDisplayName = getAgentDisplayName(agentTypeId, overrides)
  const isStructuredDisplayName = strippedDisplayName.includes(" - ")
  const displayName = isStructuredDisplayName && strippedDisplayName.toLowerCase() === canonicalDisplayName.toLowerCase()
    ? canonicalDisplayName
    : strippedDisplayName
  return {
    agentTypeId,
    displayName,
    isEligibleForTeamLead: true,
  }
}

export function shouldReuseCallerLeadSession(spec: TeamSpec, callerAgentTypeId: string | undefined): boolean {
  if (callerAgentTypeId === undefined) {
    return false
  }

  if (spec.leadAgentId === undefined) {
    return false
  }

  return true
}
