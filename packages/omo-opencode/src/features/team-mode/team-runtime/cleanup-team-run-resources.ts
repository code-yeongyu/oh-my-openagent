import { rm } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { removeTeamLayout } from "../team-layout-tmux/layout"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import type { TeamRunCreateError } from "./create"
import { unregisterTeamRunForSessionCleanup } from "./session-team-run-registry"

type SpawnedMemberResource = {
  taskId?: string
  worktreePath?: string
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function getLayoutCleanupTarget(runtimeState: Awaited<ReturnType<typeof loadRuntimeState>>) {
  if (!runtimeState.tmuxLayout) return undefined
  if (runtimeState.tmuxLayout.paneIds && runtimeState.tmuxLayout.paneIds.length > 0) {
    return runtimeState.tmuxLayout
  }

  const paneIds = runtimeState.members.flatMap((member) => {
    const ids = [member.tmuxPaneId, member.tmuxGridPaneId].filter((paneId): paneId is string => Boolean(paneId))
    return member.agentType === "leader" ? [] : ids
  })

  return paneIds.length > 0
    ? { ...runtimeState.tmuxLayout, paneIds }
    : runtimeState.tmuxLayout
}

export async function cleanupTeamRunResources(args: {
  teamRunId: string
  config: TeamModeConfig
  resources: SpawnedMemberResource[]
  bgMgr: BackgroundManager
  tmuxMgr?: TmuxSessionManager
  createdLayout: boolean
}): Promise<TeamRunCreateError["cleanupReport"]> {
  const cleanupReport: TeamRunCreateError["cleanupReport"] = {
    cancelledTaskIds: [],
    removedLayout: false,
    removedWorktrees: [],
    errors: [],
  }

  for (const resource of [...args.resources].reverse()) {
    if (resource.taskId) {
      try {
        await args.bgMgr.cancelTaskForCleanup(resource.taskId, {
          source: "team-create-rollback",
          reason: "creating_rollback",
          skipNotification: true,
        })
        cleanupReport.cancelledTaskIds.push(resource.taskId)
      } catch (cancelError) {
        cleanupReport.errors.push(`cancel ${resource.taskId}: ${normalizeError(cancelError).message}`)
      }
    }

    if (resource.worktreePath) {
      try {
        await rm(resource.worktreePath, { recursive: true, force: true })
        cleanupReport.removedWorktrees.push(resource.worktreePath)
      } catch (cleanupError) {
        cleanupReport.errors.push(`worktree ${resource.worktreePath}: ${normalizeError(cleanupError).message}`)
      }
    }
  }

  if (args.createdLayout && args.tmuxMgr) {
    try {
      const runtimeState = await loadRuntimeState(args.teamRunId, args.config)
      await removeTeamLayout(args.teamRunId, getLayoutCleanupTarget(runtimeState), args.tmuxMgr)
      cleanupReport.removedLayout = true
    } catch (layoutError) {
      cleanupReport.errors.push(`layout ${args.teamRunId}: ${normalizeError(layoutError).message}`)
    }
  }

  await transitionRuntimeState(args.teamRunId, (runtimeState) => ({ ...runtimeState, status: "failed" }), args.config).catch((transitionError) => {
    cleanupReport.errors.push(`state ${args.teamRunId}: ${normalizeError(transitionError).message}`)
    return undefined
  })

  unregisterTeamSessionsByTeam(args.teamRunId)
  unregisterTeamRunForSessionCleanup(args.teamRunId)

  return cleanupReport
}
