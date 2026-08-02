import { cleanupMemberWorktrees, loadRuntimeState, transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { log } from "@oh-my-opencode/utils"

import { clearCreateCompensation, compensateCreateMembers } from "./create-compensation"
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
    return
  }
  if (Object.keys(compensation.pending).length > 0) return
  try {
    await cleanupWorktrees()
  } catch (error) {
    log("senpi-task team create worktree cleanup deferred", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }
  try {
    if (deps.transitionCreateFailed !== undefined) await deps.transitionCreateFailed(teamRunId)
    else await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "failed" }), config)
  } catch (error) {
    log("senpi-task team create failed-state persistence deferred", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
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
