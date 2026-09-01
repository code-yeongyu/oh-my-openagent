import { AGENT_ELIGIBILITY_REGISTRY, type TeamSpec } from "./types"
import type { CallerTeamLead } from "./team-registry/caller-team-lead"

const DISPLAY_NAME_TO_AGENT_TYPE: Readonly<Record<string, string>> = {
  sisyphus: "sisyphus",
  "sisyphus - ultraworker": "sisyphus",
  hephaestus: "hephaestus",
  "hephaestus - implementation": "hephaestus",
  atlas: "atlas",
  "sisyphus-junior": "sisyphus-junior",
}

function stripAgentListSortPrefix(rawAgentName: string): string {
  return rawAgentName.replace(/^\u200B+/, "").trim()
}

function resolveAgentTypeId(displayName: string): string {
  return DISPLAY_NAME_TO_AGENT_TYPE[displayName.toLowerCase()] ?? displayName.toLowerCase()
}

export function resolveCallerTeamLead(rawAgentName: string | undefined): CallerTeamLead {
  if (typeof rawAgentName !== "string") {
    return { isEligibleForTeamLead: false }
  }

  const displayName = stripAgentListSortPrefix(rawAgentName)
  if (!displayName) {
    return { isEligibleForTeamLead: false }
  }

  const agentTypeId = resolveAgentTypeId(displayName)
  const eligibility = AGENT_ELIGIBILITY_REGISTRY[agentTypeId]
  if (!eligibility || eligibility.verdict === "hard-reject") {
    return { displayName, isEligibleForTeamLead: false }
  }

  return { agentTypeId, displayName, isEligibleForTeamLead: true }
}

export function shouldReuseCallerLeadSession(spec: TeamSpec, callerAgentTypeId: string | undefined): boolean {
  return callerAgentTypeId !== undefined && spec.leadAgentId !== undefined
}
