import { chmodSync, mkdirSync, writeFileSync } from "../fs/resilient"
import { join } from "node:path"
import { resolveHooksDir } from "../git/git-dir"
import { COMMIT_MSG_HOOK_SCRIPT, type MemoryHookChecker, withMemoryHookChecker } from "./hooks-commit-msg"
import { POST_COMMIT_HOOK_SCRIPT, PRE_COMMIT_HOOK_SCRIPT } from "./hooks-scripts"

export type { MemoryHookChecker } from "./hooks-commit-msg"
export { resolveCommonGitDir, resolveHooksDir } from "../git/git-dir"

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
