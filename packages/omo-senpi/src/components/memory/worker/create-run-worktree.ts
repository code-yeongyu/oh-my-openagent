import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

import {
  createReflectionWorktree,
  type GitMemoryRepo,
  type MemoryIdentityPaths,
  type ReflectionWorktree,
} from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./run-artifacts"

export async function createRunWorktree(
  repo: GitMemoryRepo,
  runId: string,
  paths: MemoryIdentityPaths,
): Promise<ReflectionWorktree> {
  const runDir = join(paths.reflection, "runs", runId)
  try {
    return await createReflectionWorktree(repo, runId, paths.worktrees, undefined, async (identity) => {
      await mkdir(runDir, { recursive: true, mode: 0o700 })
      await writeRunJsonAtomic(join(runDir, "prelaunch.json"), {
        version: 1,
        runId,
        worktreeDir: identity.dir,
        worktreeBranch: identity.branch,
      })
    })
  } catch (error) {
    await rm(runDir, { recursive: true, force: true })
    throw error
  }
}
