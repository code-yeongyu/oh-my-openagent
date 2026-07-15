import { rm, stat } from "node:fs/promises"

import type { TeamModeConfig } from "../config"
import { getRuntimeStateDir, resolveBaseDir } from "../team-registry/paths"
import type { RuntimeState } from "../types"
import { removeOwnedWorktreeDirectories } from "../team-worktree/ownership"

export class RuntimeWorktreeCleanupError extends Error {
  constructor(public readonly cleanupErrors: readonly string[]) {
    super(`worktree cleanup refused: ${cleanupErrors.join("; ")}`)
    this.name = "RuntimeWorktreeCleanupError"
  }
}

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
  const cleanup = await removeOwnedWorktreeDirectories(runtimeState.members.map((member) => ({
    ownedWorktreeRoot: member.ownedWorktreeRoot,
    worktreeOwnershipToken: member.worktreeOwnershipToken,
    worktreeCanonicalPath: member.worktreeCanonicalPath,
  })))
  if (cleanup.errors.length > 0) throw new RuntimeWorktreeCleanupError(cleanup.errors)
}
