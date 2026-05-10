import type { TeamModeConfig } from "../../config/schema/team-mode"
import type { BackgroundManager } from "../../features/background-agent/manager"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import { loadRuntimeState, listActiveTeams, transitionRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { TmuxSessionManager } from "../../features/tmux-subagent/manager"
import { log } from "../../shared/logger"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>

function getDeletedSessionID(properties: unknown): string | undefined {
  const record = properties as { info?: { id?: string } } | undefined
  return record?.info?.id
}

async function findLeadTeamRunId(
  deletedSessionID: string,
  config: TeamModeConfig,
): Promise<string | null> {
  const registryEntry = lookupTeamSession(deletedSessionID)
  if (registryEntry?.role === "lead") {
    try {
      const runtimeState = await loadRuntimeState(registryEntry.teamRunId, config)
      if (runtimeState.leadSessionId === undefined || runtimeState.leadSessionId === deletedSessionID) {
        return runtimeState.teamRunId
      }
    } catch (error) {
      log("team lead orphan handler registry lookup failed", {
        event: "team-mode-lead-orphan-handler-registry-error",
        teamRunId: registryEntry.teamRunId,
        deletedSessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const activeTeams = await listActiveTeams(config)

  for (const activeTeam of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)
      if (runtimeState.leadSessionId === deletedSessionID) {
        return runtimeState.teamRunId
      }
    } catch (error) {
      log("team lead orphan handler skipped runtime", {
        event: "team-mode-lead-orphan-handler-runtime-error",
        teamRunId: activeTeam.teamRunId,
        deletedSessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return null
}

export function createTeamLeadOrphanHandler(
  config: TeamModeConfig,
  tmuxMgr?: TmuxSessionManager,
  bgMgr?: BackgroundManager,
): HookImpl {
  return async ({ event }: HookInput): Promise<void> => {
    if (event.type !== "session.deleted") return

    const deletedSessionID = getDeletedSessionID(event.properties)
    if (!deletedSessionID) return

    try {
      const teamRunId = await findLeadTeamRunId(deletedSessionID, config)
      if (teamRunId === null) {
        return
      }

      const runtimeState = await loadRuntimeState(teamRunId, config)
      const nextRuntimeState = await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
        ...currentRuntimeState,
        status: "orphaned",
      }), config)

      log("team lead session deleted", {
        event: "team-mode-lead-orphaned",
        teamRunId: runtimeState.teamRunId,
        teamName: runtimeState.teamName,
        deletedSessionID,
        previousStatus: runtimeState.status,
        nextStatus: nextRuntimeState.status,
      })

      try {
        const { deleteTeam } = await import("../../features/team-mode/team-runtime/delete-team")
        await deleteTeam(teamRunId, config, tmuxMgr, bgMgr, { force: true })
      } catch (deleteError) {
        log("team lead orphan cleanup failed (non-fatal)", {
          event: "team-mode-lead-orphan-cleanup-error",
          teamRunId,
          error: deleteError instanceof Error ? deleteError.message : String(deleteError),
        })
      }
    } catch (error) {
      log("team lead orphan handler failed", {
        event: "team-mode-lead-orphan-handler-error",
        deletedSessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
