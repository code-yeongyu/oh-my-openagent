import { transitionRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { log } from "@oh-my-opencode/utils"

import { compensateCreateMembers } from "./create-compensation"
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
  try {
    const compensation = await compensateCreateMembers(teamRunId, members, deps)
    for (const error of compensation.errors) {
      log("senpi-task team create compensation deferred", { teamRunId, error: error.message })
    }
  } catch (error) {
    log("senpi-task team create compensation journal failed", {
      teamRunId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  await transitionRuntimeState(teamRunId, (state) => ({ ...state, status: "failed" }), config)
}
