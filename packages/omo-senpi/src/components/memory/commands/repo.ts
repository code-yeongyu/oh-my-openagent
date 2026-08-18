// Git repo helpers shared by the memory commands: construction with the
// production hook installer, raw read-only git, and formatting.

import { existsSync } from "node:fs"
import { join } from "node:path"

import {
  GitMemoryRepo,
  createNodeGitExec,
  installHooks,
  type GitExec,
  type GitExecResult,
} from "@oh-my-opencode/memory-core"

import type { MemoryCommandDeps, MemoryCommandIdentity } from "./types"

const RAW_GIT_TIMEOUT_MS = 30_000

export function openRepo(deps: MemoryCommandDeps, identity: MemoryCommandIdentity): GitMemoryRepo {
  return new GitMemoryRepo({
    dir: identity.identityPaths.repo,
    agentId: identity.identity,
    // installHooks returns the installed hook list; the repo option expects void.
    installHooks: (dir: string) => {
      installHooks(dir)
    },
    ...(deps.exec === undefined ? {} : { exec: deps.exec }),
  })
}

/** Raw git for read-only queries GitMemoryRepo does not expose (diff, worktree list). */
export function runGit(deps: MemoryCommandDeps, dir: string, argv: readonly string[]): Promise<GitExecResult> {
  const exec: GitExec = deps.exec ?? createNodeGitExec()
  return exec.run(argv, {
    cwd: dir,
    timeoutMs: RAW_GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

/** True only when an initialized git repo exists; shelling out otherwise throws ENOENT. */
export function hasGitRepo(identity: MemoryCommandIdentity): boolean {
  return existsSync(join(identity.identityPaths.repo, ".git"))
}
