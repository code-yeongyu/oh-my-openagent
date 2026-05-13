import fs from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "./manager"
import { spawn as bunSpawn } from "../../../shared/bun-spawn-shim"
import { RuntimeStateSchema } from "../types"

async function runGit(args: string[]): Promise<{ code: number; stderr: string }> {
  const process = bunSpawn({ cmd: ["git", ...args], stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderrText] = await Promise.all([process.exited, new Response(process.stderr).text()])
  return { code: exitCode, stderr: stderrText }
}

async function resolveWorktreeOwnerRoot(worktreePath: string): Promise<string | undefined> {
  const rootLookup = bunSpawn({
    cmd: ["git", "-C", worktreePath, "rev-parse", "--git-common-dir"],
    stdout: "pipe",
    stderr: "pipe",
  })
  const [rootExitCode, rootStdout] = await Promise.all([
    rootLookup.exited,
    new Response(rootLookup.stdout).text(),
  ])
  if (rootExitCode !== 0 || rootStdout.trim().length === 0) return undefined

  const commonDir = rootStdout.trim()
  const resolvedCommonDir = path.isAbsolute(commonDir)
    ? commonDir
    : path.resolve(worktreePath, commonDir)

  return path.basename(resolvedCommonDir) === ".git"
    ? path.dirname(resolvedCommonDir)
    : resolvedCommonDir
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  const ownerRoot = await resolveWorktreeOwnerRoot(worktreePath)

  // No git owner root means the path is either not a worktree at all
  // (e.g. the runtime-state dir under a non-git base_dir) or the owning
  // checkout is gone. Skip the `git worktree remove` call so we don't
  // raise `fatal: not a git repository` and block the directory removal
  // that callers actually depend on.
  if (!ownerRoot) {
    await fs.rm(worktreePath, { recursive: true, force: true })
    return
  }

  const result = await runGit(["-C", ownerRoot, "worktree", "remove", "--force", worktreePath])

  if (
    result.code !== 0 &&
    !result.stderr.includes("not a worktree") &&
    !result.stderr.includes("not a working tree") &&
    !result.stderr.includes("already removed")
  ) {
    throw new Error(result.stderr.trim() || "git worktree remove failed")
  }

  await fs.rm(worktreePath, { recursive: true, force: true })

  await runGit(["-C", ownerRoot, "worktree", "prune"])
}

export async function findOrphanWorktrees(baseDir: string, _config: TeamModeConfig): Promise<string[]> {
  const orphanWorktrees: string[] = []
  const worktreesDir = path.join(baseDir, "worktrees")

  let teamRunDirectories: string[]
  try {
    teamRunDirectories = await fs.readdir(worktreesDir)
  } catch {
    return orphanWorktrees
  }

  for (const teamRunId of teamRunDirectories) {
    const teamRunPath = path.join(worktreesDir, teamRunId)
    const memberNames = await fs.readdir(teamRunPath).catch(() => [])

    for (const memberName of memberNames) {
      const worktreePath = path.join(teamRunPath, memberName)
      const statePath = path.join(baseDir, "runtime", teamRunId, "state.json")

      try {
        const stateContents = await fs.readFile(statePath, "utf8")
        const parsedState = RuntimeStateSchema.safeParse(JSON.parse(stateContents))
        if (!parsedState.success) {
          orphanWorktrees.push(worktreePath)
          continue
        }

        if (parsedState.data.status !== "active" && parsedState.data.status !== "shutdown_requested") {
          orphanWorktrees.push(worktreePath)
        }
      } catch {
        orphanWorktrees.push(worktreePath)
      }
    }
  }

  return orphanWorktrees
}
