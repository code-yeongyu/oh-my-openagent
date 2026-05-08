import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { canVisualize, removeTeamLayout } from "../team-layout-tmux/layout"
import { sweepStaleTeamSessions } from "../team-layout-tmux/sweep-stale-team-sessions"
import { getRuntimeStateDir, getTeamMailboxLockPath, resolveBaseDir } from "../team-registry/paths"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { withLock } from "../team-state-store/locks"
import { listActiveTeams, transitionRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { DELETABLE_MEMBER_STATUSES, removeWorktrees } from "./shutdown-helpers"

export type DeleteTeamDeps = {
  canVisualize: typeof canVisualize
  removeTeamLayout: typeof removeTeamLayout
  log: typeof log
}

const defaultDeleteTeamDeps: DeleteTeamDeps = {
  canVisualize,
  removeTeamLayout,
  log,
}

const DELETABLE_TEAM_STATUSES = new Set<RuntimeState["status"]>([
  "active",
  "shutdown_requested",
  "deleting",
  "deleted",
])

const FORCE_DELETABLE_TEAM_STATUSES = new Set<RuntimeState["status"]>([
  ...DELETABLE_TEAM_STATUSES,
  "creating",
  "orphaned",
])

const FORCE_COMPLETABLE_MEMBER_STATUSES = new Set<RuntimeState["members"][number]["status"]>([
  "pending",
  "running",
  "idle",
])

export async function deleteTeam(
  teamRunId: string,
  config: TeamModeConfig,
  tmuxMgr?: TmuxSessionManager,
  bgMgr?: BackgroundManager,
  options?: { force?: boolean },
  deps: DeleteTeamDeps = defaultDeleteTeamDeps,
): Promise<{ removedWorktrees: string[]; removedLayout: boolean }> {
  const baseDir = resolveBaseDir(config)
  const mailboxLockPath = getTeamMailboxLockPath(baseDir, teamRunId)

  return await withLock(mailboxLockPath, async () => {
    const runtimeState = await transitionRuntimeState(teamRunId, (currentRuntimeState) => {
      const deletableTeamStatuses = options?.force === true
        ? FORCE_DELETABLE_TEAM_STATUSES
        : DELETABLE_TEAM_STATUSES
      if (!deletableTeamStatuses.has(currentRuntimeState.status)) {
        throw new Error(`team cannot be deleted from '${currentRuntimeState.status}'`)
      }

      const nonLeadMembers = currentRuntimeState.members.filter((member) => member.agentType !== "leader")
      if (options?.force !== true && nonLeadMembers.some((member) => !DELETABLE_MEMBER_STATUSES.has(member.status))) {
        throw new Error("members still active")
      }

      if (currentRuntimeState.status === "deleted") {
        return currentRuntimeState
      }

      return {
        ...currentRuntimeState,
        status: currentRuntimeState.status === "deleting" ? currentRuntimeState.status : "deleting",
        members: options?.force === true
          ? currentRuntimeState.members.map((member) => (
              member.agentType === "leader" || !FORCE_COMPLETABLE_MEMBER_STATUSES.has(member.status)
                ? member
                : { ...member, status: "completed" }
            ))
          : currentRuntimeState.members,
      }
    }, config)

    if (bgMgr && runtimeState.leadSessionId) {
      const teamMessageMarkerPrefix = `team-create:${teamRunId}:`
      const teamTasks = bgMgr.getTasksByParentSession(runtimeState.leadSessionId)
        .filter((task) => task.teamRunId === teamRunId || task.parentMessageId?.startsWith(teamMessageMarkerPrefix))
      await Promise.all(teamTasks.map((task) => bgMgr.cancelTask(task.id, {
        source: "team-mode-delete",
        reason: `delete team ${teamRunId}`,
      })))
    }

    const removedLayout = config.tmux_visualization && tmuxMgr !== undefined && deps.canVisualize()
    if (removedLayout) {
      const memberPaneIds = runtimeState.members
        .filter((member) => member.agentType !== "leader")
        .flatMap((member) => [member.tmuxPaneId, member.tmuxGridPaneId])
        .filter((paneId): paneId is string => Boolean(paneId))

      const cleanupTarget = runtimeState.tmuxLayout
        ? {
            ...runtimeState.tmuxLayout,
            paneIds: memberPaneIds.length > 0 ? memberPaneIds : runtimeState.tmuxLayout.paneIds,
          }
        : undefined

      if (options?.force === true) {
        try {
          await deps.removeTeamLayout(teamRunId, cleanupTarget, tmuxMgr)
        } catch (error) {
          deps.log("team delete layout cleanup failed", {
            teamRunId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } else {
        await deps.removeTeamLayout(teamRunId, cleanupTarget, tmuxMgr)
      }
    }

    const removedWorktrees = await removeWorktrees(runtimeState.members.map((member) => member.worktreePath))

    if (runtimeState.status !== "deleted") {
      await transitionRuntimeState(teamRunId, (currentRuntimeState) => (
        currentRuntimeState.status === "deleted"
          ? currentRuntimeState
          : { ...currentRuntimeState, status: "deleted" }
      ), config)
    }

    await removeWorktrees([getRuntimeStateDir(baseDir, teamRunId)])

    unregisterTeamSessionsByTeam(teamRunId)

    const activeTeams = await listActiveTeams(config)
    sweepStaleTeamSessions(new Set(activeTeams.map((team) => team.teamRunId))).catch(() => {})

    return { removedWorktrees, removedLayout }
  }, { ownerTag: `delete-team:${teamRunId}` })
}
