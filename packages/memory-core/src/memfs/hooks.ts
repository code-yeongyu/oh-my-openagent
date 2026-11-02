import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "../fs/resilient"
import { isAbsolute, join, resolve } from "node:path"
import { COMMIT_MSG_HOOK_SCRIPT, type MemoryHookChecker, withMemoryHookChecker } from "./hooks-commit-msg"
import { POST_COMMIT_HOOK_SCRIPT, PRE_COMMIT_HOOK_SCRIPT } from "./hooks-scripts"

export type { MemoryHookChecker } from "./hooks-commit-msg"

const HOOK_MODE = 0o755

export interface InstalledHook {
  name: "pre-commit" | "commit-msg" | "post-commit"
  path: string
}

const hookScripts = (checker: MemoryHookChecker | undefined): readonly { name: InstalledHook["name"]; script: string }[] => [
  { name: "pre-commit", script: withMemoryHookChecker(PRE_COMMIT_HOOK_SCRIPT, "pre-commit", checker) },
  { name: "commit-msg", script: withMemoryHookChecker(COMMIT_MSG_HOOK_SCRIPT, "commit-msg", checker) },
  { name: "post-commit", script: POST_COMMIT_HOOK_SCRIPT },
]

/**
 * Write the memory hooks into `repoPath`, overwriting any previous copy.
 *
 * Idempotent and cheap enough to run before every git operation: identical
 * content is rewritten rather than diffed, so a hand-edited or truncated hook
 * always heals. Linked worktrees resolve to the shared hooks directory of the
 * main repository, which is where git actually looks for them. The engine passes
 * its `checker` so the hooks validate staged notes with the TypeScript reader.
 */
export function installHooks(repoPath: string, options: { readonly checker?: MemoryHookChecker } = {}): InstalledHook[] {
  const hooksDir = resolveHooksDir(repoPath)
  mkdirSync(hooksDir, { recursive: true })

  return hookScripts(options.checker).map(({ name, script }) => {
    const path = join(hooksDir, name)
    writeFileSync(path, script, "utf8")
    chmodSync(path, HOOK_MODE)
    return { name, path }
  })
}

/**
 * Resolve the hooks directory for a repository or linked worktree.
 *
 * `.git` is a directory in a normal clone and a `gitdir:` pointer file inside
 * a linked worktree; worktrees share the hooks of the common git directory.
 */
export function resolveHooksDir(repoPath: string): string {
  return join(resolveCommonGitDir(repoPath), "hooks")
}

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

function absolutize(path: string, base: string): string {
  return isAbsolute(path) ? path : resolve(base, path)
}
