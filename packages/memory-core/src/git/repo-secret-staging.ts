import type { GitExecResult } from "./exec"
import { MemorySecretError, secretPatternClassOf } from "./secret"

/**
 * Refuse a staged commit that would carry secret-like material: first every
 * normalized path string (a file name is repository-controlled text like any
 * body), then every staged blob's full content. Reads come from the INDEX
 * (`git show :<path>`), never the worktree, and deletions are skipped because
 * their blob is gone.
 */
export async function assertNoSecretLikeStaging(
  paths: readonly string[],
  gitResult: (argv: readonly string[]) => Promise<GitExecResult>,
): Promise<void> {
  for (const path of paths) {
    const patternClass = secretPatternClassOf(path)
    if (patternClass !== undefined) throw new MemorySecretError({ path, patternClass, where: "path" })
  }
  for (const path of paths) {
    const result = await gitResult(["show", `:${path}`])
    if (result.code !== 0) continue
    const patternClass = secretPatternClassOf(result.stdout)
    if (patternClass !== undefined) throw new MemorySecretError({ path, patternClass, where: "content" })
  }
}
