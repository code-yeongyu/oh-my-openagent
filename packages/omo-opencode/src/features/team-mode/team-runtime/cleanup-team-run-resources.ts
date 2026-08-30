import { rm } from "node:fs/promises"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { removeTeamLayout } from "../team-layout-tmux/layout"
import { unregisterTeamSessionsByTeam } from "../team-session-registry"
import {
  clearLayoutCleanupRecovery,
  isIncompleteLayoutCleanupResult,
  loadRuntimeState,
  preserveLayoutCleanupRecovery,
  transitionRuntimeState,
} from "../team-state-store/store"
import type { RuntimeState } from "../types"
import type { TeamRunCreateError } from "./create"
import { unregisterTeamRunForSessionCleanup } from "./session-team-run-registry"
import { getTeamLayoutCleanupTarget } from "./team-layout-cleanup-target"

export type SpawnedMemberResource = {
  memberName: string
  taskId?: string
  worktreePath?: string
}

const ROLLBACK_TERMINALIZABLE_MEMBER_STATUSES = new Set<RuntimeState["members"][number]["status"]>([
  "idle",
  "pending",
  "running",
])

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
  const membersWithStoppedTasks = new Set<string>()
  let layoutRecoveryPrepared = false

  if (args.createdLayout) {
    try {
      await transitionRuntimeState(args.teamRunId, (runtimeState) => ({
        ...preserveLayoutCleanupRecovery(runtimeState),
        status: "deleting",
      }), args.config)
      layoutRecoveryPrepared = true
    } catch (transitionError) {
      cleanupReport.errors.push(`state ${args.teamRunId}: ${normalizeError(transitionError).message}`)
    }
  }

  for (const resource of [...args.resources].reverse()) {
    if (resource.taskId) {
      try {
        const cancelled = await args.bgMgr.cancelTask(resource.taskId, {
          source: "team-create-rollback",
          reason: "creating_rollback",
          skipNotification: true,
        })
        if (cancelled) {
          cleanupReport.cancelledTaskIds.push(resource.taskId)
          membersWithStoppedTasks.add(resource.memberName)
        } else {
          cleanupReport.errors.push(`cancel ${resource.taskId}: task remained active`)
        }
      } catch (cancelError) {
        cleanupReport.errors.push(`cancel ${resource.taskId}: ${normalizeError(cancelError).message}`)
      }
    } else {
      membersWithStoppedTasks.add(resource.memberName)
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

  if (layoutRecoveryPrepared) {
    try {
      await transitionRuntimeState(args.teamRunId, (runtimeState) => {
        return {
          ...runtimeState,
          members: runtimeState.members.map((member) => (
            member.agentType !== "leader"
            && membersWithStoppedTasks.has(member.name)
            && ROLLBACK_TERMINALIZABLE_MEMBER_STATUSES.has(member.status)
              ? { ...member, status: "errored" }
              : member
          )),
        }
      }, args.config)
    } catch (transitionError) {
      cleanupReport.errors.push(`state ${args.teamRunId}: ${normalizeError(transitionError).message}`)
    }
  }

  if (layoutRecoveryPrepared && !args.tmuxMgr) {
    cleanupReport.errors.push(`layout ${args.teamRunId}: tmux manager unavailable`)
  } else if (layoutRecoveryPrepared && args.tmuxMgr) {
    try {
      const runtimeState = await loadRuntimeState(args.teamRunId, args.config)
      const cleanupResult = await removeTeamLayout(
        args.teamRunId,
        getTeamLayoutCleanupTarget(runtimeState),
        args.tmuxMgr,
      )
      cleanupReport.removedLayout = cleanupResult.reason === "removed"
      if (!cleanupReport.removedLayout) {
        cleanupReport.errors.push(
          `layout ${args.teamRunId}: cleanup ${cleanupResult.reason}; skipped ${cleanupResult.skippedPaneIds.length} pane(s)`,
        )
      }
      if (isIncompleteLayoutCleanupResult(cleanupResult)) {
        await transitionRuntimeState(args.teamRunId, (currentRuntimeState) => (
          preserveLayoutCleanupRecovery(currentRuntimeState, cleanupResult)
        ), args.config)
      } else {
        await transitionRuntimeState(args.teamRunId, (currentRuntimeState) => ({
          ...clearLayoutCleanupRecovery(currentRuntimeState),
          status: "failed",
        }), args.config)
      }
    } catch (layoutError) {
      cleanupReport.errors.push(`layout ${args.teamRunId}: ${normalizeError(layoutError).message}`)
    }
  }

  if (!args.createdLayout) {
    await transitionRuntimeState(args.teamRunId, (runtimeState) => ({ ...runtimeState, status: "failed" }), args.config).catch((transitionError) => {
      cleanupReport.errors.push(`state ${args.teamRunId}: ${normalizeError(transitionError).message}`)
      return undefined
    })
  }

  unregisterTeamSessionsByTeam(args.teamRunId)
  unregisterTeamRunForSessionCleanup(args.teamRunId)

  return cleanupReport
}
