import { lstatSync } from "node:fs"
import { resolve } from "node:path"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { containsPath } from "@oh-my-opencode/utils"

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
  | "worktree_untrusted"

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

export function createTeamMemberRespawnLaunchResolver(
  options: TeamMemberRespawnLaunchResolverOptions,
): TrustedRespawnLaunchResolver {
  const config = toTeamCoreConfig(options.taskSettings, teamStorageBaseDir(options.stateDir))
  const inheritedExtensions = [...new Set(options.memberExtension.inheritedExtensions ?? [])]
  const extensions = [...new Set([options.memberExtension.entryPath, ...inheritedExtensions])]

  return async (record: TaskRecord) => {
    const identity = await findTeamMemberIdentity(record, config, options.stateDir)
    if (identity === undefined) return { cwd: options.stateDir.project_dir, extensions: inheritedExtensions }
    let runtime: RuntimeState
    try {
      runtime = await loadRuntimeState(identity.teamRunId, config)
    } catch {
      throw new TeamMemberRespawnLaunchError("runtime_unavailable", identity)
    }
    if (runtime.status !== "active" && runtime.status !== "shutdown_requested") {
      throw new TeamMemberRespawnLaunchError("runtime_inactive", identity)
    }
    const member = runtime.members.find((candidate) => candidate.name === identity.memberName)
    if (member === undefined) {
      throw new TeamMemberRespawnLaunchError("member_missing", identity)
    }
    const map = await readMemberTaskMap(resolveTeamRuntimeDirs(options.stateDir, identity.teamRunId).runtimeDir)
    if (map[identity.memberName] !== record.task_id) {
      throw new TeamMemberRespawnLaunchError("task_mapping_mismatch", identity)
    }
    return {
      cwd: resolveTrustedWorktreePath(member.worktreePath, options.stateDir.project_dir, identity),
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

function resolveTrustedWorktreePath(
  worktreePath: string | undefined,
  projectDir: string,
  identity: TeamMemberTaskIdentity,
): string {
  if (worktreePath === undefined) return projectDir
  const resolvedWorktreePath = resolve(projectDir, worktreePath)
  if (!containsPath(projectDir, resolvedWorktreePath)) {
    throw new TeamMemberRespawnLaunchError("worktree_untrusted", identity)
  }
  try {
    const stats = lstatSync(resolvedWorktreePath)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TeamMemberRespawnLaunchError("worktree_untrusted", identity)
    }
  } catch (error) {
    if (error instanceof TeamMemberRespawnLaunchError) throw error
    throw new TeamMemberRespawnLaunchError("worktree_untrusted", identity)
  }
  return resolvedWorktreePath
}

async function findTeamMemberIdentity(
  record: TaskRecord,
  config: ReturnType<typeof toTeamCoreConfig>,
  stateDir: StateDirConfig,
): Promise<TeamMemberTaskIdentity | undefined> {
  if (record.spawn_role !== "team_member") return undefined
  for (const team of await listActiveTeams(config)) {
    const map = await readMemberTaskMap(resolveTeamRuntimeDirs(stateDir, team.teamRunId).runtimeDir)
    const memberName = Object.entries(map).find(([, taskId]) => taskId === record.task_id)?.[0]
    if (memberName !== undefined) return { teamRunId: team.teamRunId, memberName }
  }
  throw new TeamMemberRespawnLaunchError("task_mapping_mismatch", { teamRunId: "unknown", memberName: "unknown" })
}
