import type { TeamMember, TeamTeammateMember } from "./types"

export function isTeammateMember(member: TeamMember): member is TeamTeammateMember {
  return member.agentType !== "team-lead"
}
