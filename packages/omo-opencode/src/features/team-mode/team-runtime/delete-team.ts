import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { canVisualize, removeTeamLayout } from "../team-layout-tmux/layout"
import { sweepStaleTeamSessions } from "../team-layout-tmux/sweep-stale-team-sessions"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { listActiveTeams, loadRuntimeState, saveRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import type { RuntimeState } from "../types"
import { DELETABLE_MEMBER_STATUSES, removeWorktrees } from "./shutdown-helpers"
import { unregisterTeamRunForSessionCleanup } from "./session-team-run-registry"

export type DeleteTeamDeps = {
  canVisualize: typeof canVisualize
  removeTeamLayout: typeof removeTeamLayout
  log: typeof log
}

export type DeleteTeamBackgroundManager = Pick<BackgroundManager, "getTasksByParentSession" | "cancelTaskForCleanup">

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

const FORCE_BYPASS_DELETING_STATUSES = new Set<RuntimeState["status"]>(["creating", "orphaned"])

const ACTIVE_BACKGROUND_TASK_STATUSES = new Set(["pending", "running"])
function ignoreStaleTeamSessionSweepFailure(error: unknown): void {
  if (error instanceof Error) return
}

function getTeamBackgroundTasks(
  bgMgr: DeleteTeamBackgroundManager,
  runtimeState: RuntimeState,
): ReturnType<DeleteTeamBackgroundManager["getTasksByParentSession"]> {
  if (!runtimeState.leadSessionId) return []

  const teamMessageMarkerPrefix = `team-create:${runtimeState.teamRunId}:`
  return bgMgr.getTasksByParentSession(runtimeState.leadSessionId)
    .filter((task) => task.teamRunId === runtimeState.teamRunId || task.parentMessageId?.startsWith(teamMessageMarkerPrefix))
}

export async function deleteTeam(
  teamRunId: string,
  config: TeamModeConfig,
  tmuxMgr?: TmuxSessionManager,
  bgMgr?: DeleteTeamBackgroundManager,
  options?: { force?: boolean },
  deps: DeleteTeamDeps = defaultDeleteTeamDeps,
): Promise<{ removedWorktrees: string[]; removedLayout: boolean }> {
  const runtimeState = await loadRuntimeState(teamRunId, config)
  const nonLeadMembers = runtimeState.members.filter((member) => member.agentType !== "leader")

  if (options?.force !== true && nonLeadMembers.some((member) => !DELETABLE_MEMBER_STATUSES.has(member.status))) {
    throw new Error("members still active")
  }

  const deletableTeamStatuses = options?.force === true
    ? FORCE_DELETABLE_TEAM_STATUSES
    : DELETABLE_TEAM_STATUSES
  if (!deletableTeamStatuses.has(runtimeState.status)) {
    throw new Error(`team cannot be deleted from '${runtimeState.status}'`)
  }

  if (bgMgr) {
    const teamTasks = getTeamBackgroundTasks(bgMgr, runtimeState)
    if (options?.force !== true && teamTasks.some((task) => task.status !== undefined && ACTIVE_BACKGROUND_TASK_STATUSES.has(task.status))) {
      throw new Error("members still active")
    }

    if (options?.force !== true) {
      return await deleteTeamResources(teamRunId, config, runtimeState, tmuxMgr, options, deps)
    }

    await Promise.all(teamTasks.map((task) => bgMgr.cancelTaskForCleanup(task.id, {
      source: "team-mode-delete",
      reason: `delete team ${teamRunId}`,
    })))
  }

  return await deleteTeamResources(teamRunId, config, runtimeState, tmuxMgr, options, deps)
}

async function deleteTeamResources(
  teamRunId: string,
  config: TeamModeConfig,
  runtimeState: RuntimeState,
  tmuxMgr?: TmuxSessionManager,
  options?: { force?: boolean },
  deps: DeleteTeamDeps = defaultDeleteTeamDeps,
): Promise<{ removedWorktrees: string[]; removedLayout: boolean }> {

  if (options?.force === true) {
    await transitionRuntimeState(teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      members: currentRuntimeState.members.map((member) => (
        member.agentType === "leader" || !FORCE_COMPLETABLE_MEMBER_STATUSES.has(member.status)
          ? member
          : { ...member, status: "completed" }
      )),
    }), config)
  }

  const deletableTeamStatuses = options?.force === true
    ? FORCE_DELETABLE_TEAM_STATUSES
    : DELETABLE_TEAM_STATUSES
  if (!deletableTeamStatuses.has(runtimeState.status)) {
    throw new Error(`team cannot be deleted from '${runtimeState.status}'`)
  }

  if (runtimeState.status !== "deleting" && runtimeState.status !== "deleted") {
    if (options?.force === true && FORCE_BYPASS_DELETING_STATUSES.has(runtimeState.status)) {
      const currentRuntimeState = await loadRuntimeState(teamRunId, config)
      if (currentRuntimeState.status !== "deleting" && currentRuntimeState.status !== "deleted") {
        await saveRuntimeState({ ...currentRuntimeState, status: "deleting" }, config)
      }
    } else {
      await transitionRuntimeState(teamRunId, (currentRuntimeState) => (
        currentRuntimeState.status === "deleting"
          ? currentRuntimeState
          : { ...currentRuntimeState, status: "deleting" }
      ), config)
    }
  }

  const removedLayout = config.tmux_visualization && tmuxMgr !== undefined && deps.canVisualize()
  if (removedLayout) {
    const memberPaneIds = runtimeState.members
      .flatMap((member) => (
        member.agentType !== "leader" && member.tmuxPaneId
          ? [member.tmuxPaneId]
          : []
      ))

    const cleanupTarget = runtimeState.tmuxLayout
      ? {
          ...runtimeState.tmuxLayout,
          paneIds: memberPaneIds.length > 0 ? memberPaneIds : undefined,
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

  await removeWorktrees([getRuntimeStateDir(resolveBaseDir(config), teamRunId)])

  unregisterTeamSessionsByTeam(teamRunId)
  unregisterTeamRunForSessionCleanup(teamRunId)

  const activeTeams = await listActiveTeams(config)
  sweepStaleTeamSessions(new Set(activeTeams.map((team) => team.teamRunId))).catch(ignoreStaleTeamSessionSweepFailure)

  return { removedWorktrees, removedLayout }
}
