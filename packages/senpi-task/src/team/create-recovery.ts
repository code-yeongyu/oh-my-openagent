import {
  CREATING_TIMEOUT_MS,
  claimCreatingTeamFailure,
  cleanupMemberWorktrees,
  finalizeClaimedCreatingTeamFailure,
  isCreatingStateStuck,
  listActiveTeams,
  loadRuntimeState,
} from "@oh-my-opencode/team-core/team-state-store"

import { parseTeamMemberTaskIdentity } from "./liveness-ownership"
import { readMemberTaskMap } from "./member-map"
import { toTeamCoreConfig } from "./runtime-config"
import type { CreateTeamDeps } from "./runtime-types"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"
import {
  clearCreateCompensation,
  compensateCreateMembers,
  listCreateCompensations,
  type CreateCompensationMap,
} from "./create-compensation"

export type RecoverStaleCreatingTeamsResult = {
  readonly markedFailed: number
  readonly errors: readonly Error[]
}

export async function recoverStaleCreatingTeams(
  deps: Pick<CreateTeamDeps, "manager" | "destruction" | "stateDir" | "taskSettings" | "now" | "writeCreateCompensation">,
): Promise<RecoverStaleCreatingTeamsResult> {
  const errors: Error[] = []
  let markedFailed = 0
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))

  for (const journal of await listCreateCompensations(deps.stateDir)) {
    try {
      let runtimeState
      try {
        runtimeState = await loadRuntimeState(journal.teamRunId, config)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
        const compensation = await compensateCreateMembers(journal.teamRunId, journal.members, deps)
        errors.push(...compensation.errors)
        if (Object.keys(compensation.pending).length === 0) {
          await clearCreateCompensation(deps.stateDir, journal.teamRunId)
        }
        continue
      }
      if (runtimeState.status === "creating" || runtimeState.status === "create_cleanup_pending") {
        const claimedState = await claimCreatingTeamFailure(runtimeState.teamRunId, config)
        if (claimedState === null) continue
        const compensation = await compensateCreateMembers(journal.teamRunId, journal.members, deps)
        errors.push(...compensation.errors)
        if (Object.keys(compensation.pending).length > 0) continue
        await cleanupMemberWorktrees(claimedState)
        await finalizeClaimedCreatingTeamFailure(claimedState.teamRunId, config)
        markedFailed += 1
      } else if (runtimeState.status === "failed") {
        const compensation = await compensateCreateMembers(journal.teamRunId, journal.members, deps)
        errors.push(...compensation.errors)
        if (Object.keys(compensation.pending).length > 0) continue
      } else {
        continue
      }
      await clearCreateCompensation(deps.stateDir, journal.teamRunId)
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const activeTeams = await listActiveTeams(config)
  for (const team of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(team.teamRunId, config)
      const shouldRecover = runtimeState.status === "create_cleanup_pending"
        || isCreatingStateStuck(runtimeState, (deps.now ?? Date.now)(), CREATING_TIMEOUT_MS)
      if (!shouldRecover) continue
      const claimedState = await claimCreatingTeamFailure(runtimeState.teamRunId, config)
      if (claimedState === null) continue
      const members = await discoverCreatingMembers(claimedState.teamRunId, claimedState.members.map((member) => member.name), deps)
      const compensation = await compensateCreateMembers(claimedState.teamRunId, members, deps)
      errors.push(...compensation.errors)
      if (Object.keys(compensation.pending).length > 0) continue
      await cleanupMemberWorktrees(claimedState)
      await finalizeClaimedCreatingTeamFailure(claimedState.teamRunId, config)
      await clearCreateCompensation(deps.stateDir, claimedState.teamRunId)
      markedFailed += 1
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return { markedFailed, errors }
}

async function discoverCreatingMembers(
  teamRunId: string,
  runtimeMemberNames: readonly string[],
  deps: Pick<CreateTeamDeps, "manager" | "stateDir">,
): Promise<CreateCompensationMap> {
  const allowedMembers = new Set(runtimeMemberNames)
  const sidecar = await readMemberTaskMap(resolveTeamRuntimeDirs(deps.stateDir, teamRunId).runtimeDir)
  const discovered: Record<string, string> = {}
  for (const [memberName, taskId] of Object.entries(sidecar)) {
    if (allowedMembers.has(memberName)) discovered[memberName] = taskId
  }
  for (const { record } of deps.manager.list({ scope: "all" })) {
    const identity = parseTeamMemberTaskIdentity(record)
    if (identity?.teamRunId !== teamRunId || !allowedMembers.has(identity.memberName)) continue
    discovered[identity.memberName] = record.task_id
  }
  return discovered
}
