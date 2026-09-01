import type { TeamModeConfig } from "../../config/schema/team-mode"
import { log } from "../../shared/logger"
import { lookupTeamSession } from "./team-session-registry"
import { listActiveTeams, loadRuntimeState } from "./team-state-store/store"

export type ResolvedMemberSession = {
  teamRunId: string
  memberName: string
}

export async function findResolvedMemberSession(
  sessionID: string,
  config: TeamModeConfig,
  logContext: string,
): Promise<ResolvedMemberSession | null> {
  const registryEntry = lookupTeamSession(sessionID)
  if (registryEntry?.role === "member") {
    try {
      const runtimeState = await loadRuntimeState(registryEntry.teamRunId, config)
      const memberEntry = runtimeState.members.find(
        (member) => member.name === registryEntry.memberName
          && (member.sessionId === undefined || member.sessionId === sessionID),
      )

      if (memberEntry !== undefined) {
        return {
          teamRunId: runtimeState.teamRunId,
          memberName: memberEntry.name,
        }
      }
    } catch (error) {
      log(`${logContext} registry lookup failed`, {
        event: `${logContext}-registry-error`,
        teamRunId: registryEntry.teamRunId,
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const activeTeams = await listActiveTeams(config)
  for (const activeTeam of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)
      const memberEntry = runtimeState.members.find((member) => member.sessionId === sessionID)
      if (memberEntry !== undefined) {
        return {
          teamRunId: runtimeState.teamRunId,
          memberName: memberEntry.name,
        }
      }
    } catch (error) {
      log(`${logContext} skipped runtime`, {
        event: `${logContext}-runtime-error`,
        teamRunId: activeTeam.teamRunId,
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return null
}
