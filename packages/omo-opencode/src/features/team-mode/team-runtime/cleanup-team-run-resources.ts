import { rm } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { removeTeamLayout } from "../team-layout-tmux/layout"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import { unregisterTeamRunForSessionCleanup } from "./session-team-run-registry"
import type { SpawnedMemberResource, TeamRunCleanupReport } from "./team-run-create-types"
import { removeOwnedWorktreeDirectories } from "./worktree-ownership"

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

function createCleanupReport(): TeamRunCleanupReport {
  return {
    cancelledTaskIds: [],
    removedLayout: false,
    removedWorktrees: [],
    errors: [],
  }
}

async function removePreparedResourcePaths(args: {
  resources: SpawnedMemberResource[]
  inboxDirs: string[]
  cleanupReport: TeamRunCleanupReport
}): Promise<void> {
  const worktreeCleanup = await removeOwnedWorktreeDirectories(args.resources.toReversed())
  args.cleanupReport.removedWorktrees.push(...worktreeCleanup.removedWorktrees)
  args.cleanupReport.errors.push(...worktreeCleanup.errors)

  for (const inboxDir of [...args.inboxDirs].reverse()) {
    try {
      await rm(inboxDir, { recursive: true, force: true })
    } catch (cleanupError) {
      args.cleanupReport.errors.push(`inbox ${inboxDir}: ${normalizeError(cleanupError).message}`)
    }
  }
}

export async function cleanupPreparedTeamRunResources(args: {
  resources: SpawnedMemberResource[]
  inboxDirs?: string[]
}): Promise<TeamRunCleanupReport> {
  const cleanupReport = createCleanupReport()
  await removePreparedResourcePaths({
    resources: args.resources,
    inboxDirs: args.inboxDirs ?? [],
    cleanupReport,
  })
  return cleanupReport
}

export async function cleanupTeamRunResources(args: {
  teamRunId: string
  config: TeamModeConfig
  resources: SpawnedMemberResource[]
  bgMgr: BackgroundManager
  tmuxMgr?: TmuxSessionManager
  createdLayout: boolean
  inboxDirs?: string[]
}): Promise<TeamRunCleanupReport> {
  const cleanupReport = createCleanupReport()

  for (const resource of [...args.resources].reverse()) {
    if (resource.taskId) {
      try {
        const cancelled = await args.bgMgr.cancelTask(resource.taskId, {
          source: "team-create-rollback",
          reason: "creating_rollback",
          skipNotification: true,
        })
        if (cancelled !== true) {
          cleanupReport.errors.push(`cancel ${resource.taskId}: cancellation was not confirmed`)
        } else {
          cleanupReport.cancelledTaskIds.push(resource.taskId)
        }
      } catch (cancelError) {
        cleanupReport.errors.push(`cancel ${resource.taskId}: ${normalizeError(cancelError).message}`)
      }
    }

  }

  if (cleanupReport.errors.some((error) => error.startsWith("cancel "))) {
    return cleanupReport
  }

  await removePreparedResourcePaths({
    resources: args.resources,
    inboxDirs: args.inboxDirs ?? [],
    cleanupReport,
  })

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
