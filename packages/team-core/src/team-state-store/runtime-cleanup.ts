import { rm, stat } from "node:fs/promises"

import type { TeamModeConfig } from "../config"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import type { RuntimeState } from "../types"

function isEnoentError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT"
}

async function runtimeDirectoryExists(teamRunId: string, config: TeamModeConfig): Promise<boolean> {
  try {
    await stat(getRuntimeStateDir(resolveBaseDir(config), teamRunId))
    return true
  } catch (error) {
    if (isEnoentError(error)) return false
    throw error
  }
}

export async function removeRuntimeDirectory(teamRunId: string, config: TeamModeConfig): Promise<boolean> {
  if (!(await runtimeDirectoryExists(teamRunId, config))) return false
  await rm(getRuntimeStateDir(resolveBaseDir(config), teamRunId), { recursive: true, force: true })
  return true
}

export async function cleanupMemberWorktrees(runtimeState: RuntimeState): Promise<void> {
  await Promise.all(runtimeState.members.map(async (member) => {
    if (!member.worktreePath) return
    await rm(member.worktreePath, { recursive: true, force: true })
  }))
}
