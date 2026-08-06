import {
  claimCreatingTeamFailure,
  cleanupMemberWorktrees,
  createCleanupClaimant,
  finalizeClaimedCreatingTeamFailure,
  loadRuntimeState,
  releaseClaimedCreatingTeamFailure,
} from "@oh-my-opencode/team-core/team-state-store"
import { log } from "@oh-my-opencode/utils"

import {
  clearCreateCompensation,
  compensateCreateMembers,
  writeCreateCompensation,
} from "./create-compensation"
import type { TeamCoreConfig } from "./runtime-config"
import type { CreateTeamDeps } from "./runtime-types"
import type { SpawnedMember } from "./spawn-members"

export async function rollbackFailedCreate(
  teamRunId: string,
  spawned: ReadonlyMap<string, SpawnedMember>,
  deps: CreateTeamDeps,
  config: TeamCoreConfig,
): Promise<void> {
  const members = Object.fromEntries([...spawned].map(([memberName, member]) => [memberName, member.taskId]))
  const persistCompensation = deps.writeCreateCompensation ?? writeCreateCompensation
  try {
    await persistCompensation(deps.stateDir, teamRunId, members)
  } catch (error) {
    log("senpi-task team create compensation journal failed", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  const claimant = createCleanupClaimant()
  const releaseClaim = async (): Promise<void> => {
    try {
      await releaseClaimedCreatingTeamFailure(teamRunId, claimant, config)
    } catch (error) {
      log("senpi-task team create cleanup lease release failed", {
        teamRunId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  let claimedState
  try {
    claimedState = await claimCreatingTeamFailure(teamRunId, claimant, config, { now: deps.now })
  } catch (error) {
    log("senpi-task team create cleanup lease claim failed", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  if (claimedState === null) return
  let worktreesCleaned = false
  const cleanupWorktrees = async (): Promise<void> => {
    if (worktreesCleaned) return
    const state = await loadRuntimeState(teamRunId, config)
    await cleanupMemberWorktrees(state)
    worktreesCleaned = true
  }
  let compensation: Awaited<ReturnType<typeof compensateCreateMembers>>
  try {
    compensation = await compensateCreateMembers(teamRunId, members, { ...deps, beforeClear: cleanupWorktrees })
    for (const error of compensation.errors) {
      log("senpi-task team create compensation deferred", { teamRunId, error: error.message })
    }
  } catch (error) {
    log("senpi-task team create compensation journal failed", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    await releaseClaim()
    return
  }
  if (Object.keys(compensation.pending).length > 0) {
    await releaseClaim()
    return
  }
  try {
    await cleanupWorktrees()
  } catch (error) {
    log("senpi-task team create worktree cleanup deferred", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    await releaseClaim()
    return
  }
  try {
    if (deps.transitionCreateFailed !== undefined) await deps.transitionCreateFailed(teamRunId)
    else if (!(await finalizeClaimedCreatingTeamFailure(teamRunId, claimant, config))) return
  } catch (error) {
    log("senpi-task team create failed-state persistence deferred", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    await releaseClaim()
    return
  }
  try {
    await clearCreateCompensation(deps.stateDir, teamRunId)
  } catch (error) {
    log("senpi-task team create compensation cleanup deferred", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
