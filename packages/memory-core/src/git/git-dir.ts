import { existsSync, readFileSync, statSync } from "../fs/resilient"
import { isAbsolute, join, resolve } from "node:path"

/**
 * Resolve the common git directory for a repository or linked worktree.
 *
 * `.git` is a directory in a normal clone and a `gitdir:` pointer file inside
 * a linked worktree; worktrees share the hooks of the common git directory.
 *
 * This lives in `git/` rather than `memfs/hooks.ts` so both the git command
 * boundary (`exec.ts`, omo #12367) and the hook installer can use it:
 * `memfs/hooks.ts` reaches `git/` through `sync/mirror`, so importing the
 * resolver from there would cycle back into this package's git barrel.
 */
export function resolveCommonGitDir(repoPath: string): string {
  const dotGit = join(repoPath, ".git")
  if (!existsSync(dotGit) || statSync(dotGit).isDirectory()) return dotGit

  const pointer = readFileSync(dotGit, "utf8").trim()
  const match = /^gitdir:\s*(.+)$/.exec(pointer)
  if (!match?.[1]) return dotGit

  const gitDir = absolutize(match[1].trim(), repoPath)
  const commonDirFile = join(gitDir, "commondir")
  if (!existsSync(commonDirFile)) return gitDir
  return absolutize(readFileSync(commonDirFile, "utf8").trim(), gitDir)
}

/** Resolve the hooks directory for a repository or linked worktree. */
export function resolveHooksDir(repoPath: string): string {
  return join(resolveCommonGitDir(repoPath), "hooks")
}

function absolutize(path: string, base: string): string {
  return isAbsolute(path) ? path : resolve(base, path)
}
