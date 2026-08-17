import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

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
  let created = false
  try {
    return await createReflectionWorktree(repo, runId, paths.worktrees, undefined, async (identity) => {
      // Exclusive creation: a run directory that already exists belongs to an earlier run that
      // minted the same id. Adopting it would let that run's final.json/outcome.json/terminal-claim
      // decide this run's fate, which is how a failed run gets reported as the older run's success.
      await mkdir(dirname(runDir), { recursive: true, mode: 0o700 })
      try {
        await mkdir(runDir, { mode: 0o700 })
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          throw new Error(`Reflection run directory already exists for ${runId}; refusing to reuse it`)
        }
        throw error
      }
      created = true
      await writeRunJsonAtomic(join(runDir, "prelaunch.json"), {
        version: 1,
        runId,
        worktreeDir: identity.dir,
        worktreeBranch: identity.branch,
      })
    })
  } catch (error) {
    // Only discard a directory this call created; a colliding one holds another run's artifacts.
    if (created) await rm(runDir, { recursive: true, force: true })
    throw error
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}
