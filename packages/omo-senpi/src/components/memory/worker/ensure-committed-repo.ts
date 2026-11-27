import { existsSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { GitMemoryRepo, buildDefaultSeedFiles, installHooks, type MemoryIdentityPaths } from "@oh-my-opencode/memory-core"

import { memoryHookChecker } from "./spawn-supervisor-support"

/**
 * A memory repo whose `git init` ran but whose first commit never landed has an unborn HEAD: every
 * reflection run then fails as "without a parent HEAD" and every facts finalize fails its git log,
 * and nothing repairs it - retrying cannot succeed. `init()` is idempotent and creates the same
 * initial commit a fresh identity gets (#13948).
 */
export async function ensureCommittedMemoryRepo(
  paths: MemoryIdentityPaths,
  agentId: string,
): Promise<GitMemoryRepo> {
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId })
  if (existsSync(join(paths.repo, ".git")) && (await repo.head()) !== null) return repo
  await repo.init({
    seedFiles: buildDefaultSeedFiles(),
    installHooks: (dir) => {
      installHooks(dir, { checker: memoryHookChecker() })
    },
  })
  return repo
}
