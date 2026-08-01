import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"

import type { TaskRecord } from "../state"
import type { StateDirConfig } from "../store"
import { toTeamCoreConfig } from "./runtime-config"
import { teamStorageBaseDir } from "./storage"

export type TeamMemberTaskIdentity = {
  readonly teamRunId: string
  readonly memberName: string
}

export type TeamMemberOwnershipDeps = {
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
  readonly loadRuntimeState?: (teamRunId: string, config: Parameters<typeof loadRuntimeState>[1]) => Promise<RuntimeState>
}

const TEAM_MEMBER_NAME_PATTERN = /^team:([0-9a-f-]{36}):([a-z0-9-]+)$/i

export function parseTeamMemberTaskIdentity(record: Pick<TaskRecord, "name">): TeamMemberTaskIdentity | undefined {
  const match = TEAM_MEMBER_NAME_PATTERN.exec(record.name ?? "")
  const teamRunId = match?.[1]
  const memberName = match?.[2]
  return teamRunId === undefined || memberName === undefined ? undefined : { teamRunId, memberName }
}

export async function isOwnedTeamMemberTask(
  record: Pick<TaskRecord, "name">,
  currentSessionId: string | undefined,
  deps: TeamMemberOwnershipDeps,
): Promise<boolean> {
  if (currentSessionId === undefined || currentSessionId.length === 0) return false
  const identity = parseTeamMemberTaskIdentity(record)
  if (identity === undefined) return false
  const config = toTeamCoreConfig(deps.taskSettings, teamStorageBaseDir(deps.stateDir))
  try {
    const loader = deps.loadRuntimeState ?? loadRuntimeState
    const runtimeState = await loader(identity.teamRunId, config)
    return runtimeState.leadSessionId === currentSessionId
      && runtimeState.members.some((member) => member.name === identity.memberName)
  } catch {
    return false
  }
}
