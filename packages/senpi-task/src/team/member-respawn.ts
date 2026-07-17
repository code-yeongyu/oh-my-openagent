import { loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { TrustedRespawnLaunchResolver } from "../manager"
import type { TaskRecord } from "../state"
import { resolveStateDir, type StateDirConfig } from "../store"
import { readMemberTaskMap } from "./member-map"
import type { TeamMemberExtensionConfig } from "./runtime-types"
import { toTeamCoreConfig } from "./runtime-config"
import { resolveTeamRuntimeDirs, teamStorageBaseDir } from "./storage"

type TeamMemberTaskIdentity = {
  readonly teamRunId: string
  readonly memberName: string
}

export type TeamMemberRespawnLaunchErrorCode =
  | "runtime_unavailable"
  | "runtime_inactive"
  | "member_missing"
  | "task_mapping_mismatch"

export class TeamMemberRespawnLaunchError extends Error {
  readonly code: TeamMemberRespawnLaunchErrorCode

  constructor(code: TeamMemberRespawnLaunchErrorCode, identity: TeamMemberTaskIdentity) {
    super(`Cannot respawn team member '${identity.memberName}': ${code}`)
    this.name = "TeamMemberRespawnLaunchError"
    this.code = code
  }
}

export type TeamMemberRespawnLaunchResolverOptions = {
  readonly stateDir: StateDirConfig
  readonly taskSettings: OmoTaskSettings
  readonly memberExtension: TeamMemberExtensionConfig
}

function parseTeamMemberTaskName(name: string | undefined): TeamMemberTaskIdentity | undefined {
  if (name === undefined) return undefined
  const match = /^team:([0-9a-f-]{36}):([a-z0-9-]+)$/.exec(name)
  const teamRunId = match?.[1]
  const memberName = match?.[2]
  return teamRunId === undefined || memberName === undefined ? undefined : { teamRunId, memberName }
}

export function createTeamMemberRespawnLaunchResolver(
  options: TeamMemberRespawnLaunchResolverOptions,
): TrustedRespawnLaunchResolver {
  const config = toTeamCoreConfig(options.taskSettings, teamStorageBaseDir(options.stateDir))
  const inheritedExtensions = [...new Set(options.memberExtension.inheritedExtensions ?? [])]
  const extensions = [...new Set([options.memberExtension.entryPath, ...inheritedExtensions])]

  return async (record: TaskRecord) => {
    const identity = parseTeamMemberTaskName(record.name)
    if (identity === undefined) return { extensions: inheritedExtensions }
    let runtime: RuntimeState
    try {
      runtime = await loadRuntimeState(identity.teamRunId, config)
    } catch {
      throw new TeamMemberRespawnLaunchError("runtime_unavailable", identity)
    }
    if (runtime.status !== "active" && runtime.status !== "shutdown_requested") {
      throw new TeamMemberRespawnLaunchError("runtime_inactive", identity)
    }
    if (!runtime.members.some((member) => member.name === identity.memberName)) {
      throw new TeamMemberRespawnLaunchError("member_missing", identity)
    }
    const map = await readMemberTaskMap(resolveTeamRuntimeDirs(options.stateDir, identity.teamRunId).runtimeDir)
    if (map[identity.memberName] !== record.task_id) {
      throw new TeamMemberRespawnLaunchError("task_mapping_mismatch", identity)
    }
    return {
      extensions,
      memberEnv: {
        SENPI_TASK_MEMBER: `${runtime.teamRunId}::${identity.memberName}`,
        SENPI_TASK_MEMBER_TASK_ID: record.task_id,
        SENPI_TASK_TEAM_CONFIG: JSON.stringify({
          ...config,
          stateDir: resolveStateDir(options.stateDir),
          members: runtime.members.map((member) => member.name),
          wait: options.taskSettings.wait,
        }),
      },
    }
  }
}
