import { isTeammateMember } from "./team-member-utils"
import type { TeamConfig, TeamToolContext } from "./types"

export function nowIso(): string {
  return new Date().toISOString()
}

export function validateRecipientTeam(recipient: unknown, teamName: string): string | null {
  if (typeof recipient !== "string") {
    return null
  }

  const trimmed = recipient.trim()
  const atIndex = trimmed.indexOf("@")
  if (atIndex <= 0) {
    return null
  }

  const specifiedTeam = trimmed.slice(atIndex + 1).trim()
  if (!specifiedTeam) {
    return "recipient_team_invalid"
  }
  if (specifiedTeam === teamName) {
    return null
  }

  return "recipient_team_mismatch"
}

export function resolveSenderFromContext(config: TeamConfig, context: TeamToolContext): string | null {
  if (context.sessionID === config.leadSessionId) {
    return "team-lead"
  }

  const matchedMember = config.members.find((member) => isTeammateMember(member) && member.sessionID === context.sessionID)
  return matchedMember?.name ?? null
}
