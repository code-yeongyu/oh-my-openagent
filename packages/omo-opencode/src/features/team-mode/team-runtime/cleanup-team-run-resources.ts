import { rm } from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { removeTeamLayout } from "../team-layout-tmux/layout"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import { unregisterTeamRunForSessionCleanup } from "./session-team-run-registry"
import type { SpawnedMemberResource, TeamRunCleanupReport } from "./team-run-create-types"

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

function isOwnedRootInside(candidate: string, potentialParent: string): boolean {
  const relativePath = path.relative(potentialParent, candidate)
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
}

function getOwnedWorktreeRoots(resources: SpawnedMemberResource[]): string[] {
  const roots = [...new Set(resources.toReversed().flatMap((resource) => (
    resource.ownedWorktreeRoot ? [resource.ownedWorktreeRoot] : []
  )))]
  return roots.filter((root) => !roots.some((candidateParent) => (
    candidateParent !== root && isOwnedRootInside(root, candidateParent)
  )))
}

async function removePreparedResourcePaths(args: {
  resources: SpawnedMemberResource[]
  inboxDirs: string[]
  cleanupReport: TeamRunCleanupReport
}): Promise<void> {
  for (const ownedWorktreeRoot of getOwnedWorktreeRoots(args.resources)) {
    try {
      await rm(ownedWorktreeRoot, { recursive: true, force: true })
      args.cleanupReport.removedWorktrees.push(ownedWorktreeRoot)
    } catch (cleanupError) {
      args.cleanupReport.errors.push(`worktree ${ownedWorktreeRoot}: ${normalizeError(cleanupError).message}`)
    }
  }

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
