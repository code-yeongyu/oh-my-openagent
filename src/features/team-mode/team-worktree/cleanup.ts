import fs from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "./manager"

async function runGit(args: string[]): Promise<{ code: number; stderr: string }> {
  const process = Bun.spawn({ cmd: ["git", ...args], stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderrText] = await Promise.all([process.exited, new Response(process.stderr).text()])
  return { code: exitCode, stderr: stderrText }
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  await fs.rm(worktreePath, { recursive: true, force: true })

  const rootLookup = await Bun.spawn({
    cmd: ["git", "-C", worktreePath, "rev-parse", "--show-superproject-working-tree"],
    stdout: "pipe",
    stderr: "pipe",
  })
  const [rootExitCode, rootStdout] = await Promise.all([
    rootLookup.exited,
    new Response(rootLookup.stdout).text(),
    new Response(rootLookup.stderr).text(),
  ])
  const result =
    rootExitCode === 0 && rootStdout.trim().length > 0
      ? await runGit(["-C", rootStdout.trim(), "worktree", "remove", "--force", worktreePath])
      : await runGit(["worktree", "remove", "--force", worktreePath])

  if (
    result.code !== 0 &&
    !result.stderr.includes("not a worktree") &&
    !result.stderr.includes("not a working tree") &&
    !result.stderr.includes("already removed")
  ) {
    throw new Error(result.stderr.trim() || "git worktree remove failed")
  }

  if (rootExitCode === 0 && rootStdout.trim().length > 0) {
    await runGit(["-C", rootStdout.trim(), "worktree", "prune"])
  }
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
        const state = JSON.parse(stateContents) as { status?: string }

        if (state.status !== "active" && state.status !== "shutdown_requested") {
          orphanWorktrees.push(worktreePath)
        }
      } catch {
        orphanWorktrees.push(worktreePath)
      }
    }
  }

  return orphanWorktrees
}
