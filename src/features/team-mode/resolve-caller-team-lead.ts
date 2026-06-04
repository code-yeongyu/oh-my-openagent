import { getAgentConfigKey, getAgentDisplayName, stripAgentListSortPrefix } from "../../shared/agent-display-names"

import { AGENT_ELIGIBILITY_REGISTRY, type TeamSpec } from "./types"

export type CallerTeamLead = {
  agentTypeId?: string
  displayName?: string
  isEligibleForTeamLead: boolean
}

export function resolveCallerTeamLead(rawAgentName: string | undefined): CallerTeamLead {
  if (typeof rawAgentName !== "string") {
    return { isEligibleForTeamLead: false }
  }

  const strippedDisplayName = stripAgentListSortPrefix(rawAgentName).trim()
  if (!strippedDisplayName) {
    return { isEligibleForTeamLead: false }
  }

  const agentTypeId = getAgentConfigKey(strippedDisplayName)
  const canonicalDisplayName = getAgentDisplayName(agentTypeId)
  const isStructuredDisplayName = strippedDisplayName.includes(" - ")
  const displayName = isStructuredDisplayName && strippedDisplayName.toLowerCase() === canonicalDisplayName.toLowerCase()
    ? canonicalDisplayName
    : strippedDisplayName
  const eligibility = AGENT_ELIGIBILITY_REGISTRY[agentTypeId]
  if (!eligibility || eligibility.verdict === "hard-reject") {
    return {
      displayName,
      isEligibleForTeamLead: false,
    }
  }

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
