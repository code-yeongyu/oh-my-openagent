import { dirname, join } from "node:path"

import {
  getInboxDir,
  getRuntimeStateDir,
  getTasksDir,
  getTeamSpecPath,
} from "@oh-my-opencode/team-core/team-registry"

import { resolveStateDir } from "../store"
import { ensurePrivateDirectory } from "../store/state-permissions"
import type { StateDirConfig } from "../store"

export type TeamRuntimeDirs = {
  readonly baseDir: string
  readonly runtimeDir: string
  readonly tasksDir: string
}

/**
 * Runtime-state base dir for ALL senpi team storage: `<resolveStateDir(cfg)>/teams`. This is the
 * baseDir passed to the team-core path helpers, NOT the omo-compatible `.omo/teams` discovery path.
 */
export function teamStorageBaseDir(config: StateDirConfig): string {
  return join(resolveStateDir(config), "teams")
}

export function resolveTeamRuntimeDirs(config: StateDirConfig, teamRunId: string): TeamRuntimeDirs {
  const baseDir = teamStorageBaseDir(config)
  return {
    baseDir,
    runtimeDir: getRuntimeStateDir(baseDir, teamRunId),
    tasksDir: getTasksDir(baseDir, teamRunId),
  }
}

export function resolveTeamMemberInboxDir(config: StateDirConfig, teamRunId: string, memberName: string): string {
  return getInboxDir(teamStorageBaseDir(config), teamRunId, memberName)
}

/**
 * The omo-compatible `<projectRoot>/.omo/teams/<name>/config.json` path. Discovery-only: it is read
 * for spec discovery and is NEVER a runtime-write target (runtime state lives under the state dir).
 */
export function resolveProjectTeamSpecPath(projectRoot: string, teamName: string): string {
  return getTeamSpecPath(projectRoot, teamName, "project", projectRoot)
}

export async function ensureTeamRuntimeDirs(
  config: StateDirConfig,
  teamRunId: string,
  memberNames: readonly string[],
): Promise<TeamRuntimeDirs> {
  const dirs = resolveTeamRuntimeDirs(config, teamRunId)
  ensurePrivateDirectory(dirs.baseDir)
  ensurePrivateDirectory(dirname(dirs.runtimeDir))
  ensurePrivateDirectory(dirs.runtimeDir)
  ensurePrivateDirectory(dirs.tasksDir)
  for (const memberName of memberNames) {
    const inboxDir = resolveTeamMemberInboxDir(config, teamRunId, memberName)
    ensurePrivateDirectory(dirname(inboxDir))
    ensurePrivateDirectory(inboxDir)
  }
  return dirs
}
