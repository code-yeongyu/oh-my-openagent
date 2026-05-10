import { rm } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { removeTeamLayout } from "../team-layout-tmux/layout"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import type { TeamRunCreateError } from "./create"

type SpawnedMemberResource = {
  taskId?: string
  worktreePath?: string
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
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
        await args.bgMgr.cancelTask(resource.taskId, {
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
      await removeTeamLayout(args.teamRunId, runtimeState.tmuxLayout, args.tmuxMgr)
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

  return cleanupReport
}
