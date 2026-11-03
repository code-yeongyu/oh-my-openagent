import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "../fs/resilient"
import { isAbsolute, join, resolve } from "node:path"
import { COMMIT_MSG_HOOK_SCRIPT, type MemoryHookChecker, withMemoryHookChecker } from "./hooks-commit-msg"
import { POST_COMMIT_HOOK_SCRIPT, PRE_COMMIT_HOOK_SCRIPT } from "./hooks-scripts"

export type { MemoryHookChecker } from "./hooks-commit-msg"

const HOOK_MODE = 0o755
// Every hook script omo has ever installed carries this phrase in its header comment (memory-core port onward).
const OMO_HOOK_MARKER = "Installed by omo memory-core"
const CHECKER_LINE_RE = /^omo_hook_(runtime|script)='((?:[^']|'\\'')*)'$/gm

export interface InstalledHook {
  name: "pre-commit" | "commit-msg" | "post-commit"
  path: string
  /**
   * `written`: the omo hook was missing or stale and now holds this release's script. `current`: it already did.
   * `foreign`: a hook omo did not install sits there; it is left exactly as it is.
   */
  status: "written" | "current" | "foreign"
}

const hookScripts = (checker: MemoryHookChecker | undefined): readonly { name: InstalledHook["name"]; script: string }[] => [
  { name: "pre-commit", script: withMemoryHookChecker(PRE_COMMIT_HOOK_SCRIPT, "pre-commit", checker) },
  { name: "commit-msg", script: withMemoryHookChecker(COMMIT_MSG_HOOK_SCRIPT, "commit-msg", checker) },
  { name: "post-commit", script: POST_COMMIT_HOOK_SCRIPT },
]

/**
 * Install the memory hooks into `repoPath`: a missing, empty or stale omo hook is replaced by this release's
 * script, a hook omo did not install is reported as `foreign` and left alone. Linked worktrees resolve to the
 * shared hooks directory of the main repository, which is where git actually looks for them. The engine passes
 * its `checker` so the hooks validate staged notes with the TypeScript reader.
 */
export function installHooks(repoPath: string, options: { readonly checker?: MemoryHookChecker } = {}): InstalledHook[] {
  return syncMemoryHooks(repoPath, { checker: options.checker, installMissing: true })
}

/**
 * The migration every memory writer runs before it commits (#12221): an omo hook an older release installed is
 * rewritten to this release's script, keeping the engine checker it was installed with, so the hook and the
 * writers always enforce the same rule. A repository with no hooks gets none, and a foreign hook is left alone.
 */
export function migrateMemoryHooks(repoPath: string): InstalledHook[] {
  return syncMemoryHooks(repoPath, { checker: undefined, installMissing: false })
}

function syncMemoryHooks(
  repoPath: string,
  options: { readonly checker: MemoryHookChecker | undefined; readonly installMissing: boolean },
): InstalledHook[] {
  const hooksDir = resolveHooksDir(repoPath)
  if (!options.installMissing && !existsSync(hooksDir)) return []
  mkdirSync(hooksDir, { recursive: true })
  const installed = readInstalled(hooksDir)
  const checker = options.checker ?? installedChecker(installed)

  return hookScripts(checker).flatMap(({ name, script }): InstalledHook[] => {
    const path = join(hooksDir, name)
    const current = installed.get(name)
    if (current === undefined && !options.installMissing) return []
    if (current !== undefined && current.trim() !== "" && !current.includes(OMO_HOOK_MARKER)) return [{ name, path, status: "foreign" }]
    if (current === script) return [{ name, path, status: "current" }]
    replaceAtomically(path, script)
    return [{ name, path, status: "written" }]
  })
}

function readInstalled(hooksDir: string): Map<string, string> {
  const installed = new Map<string, string>()
  for (const name of ["pre-commit", "commit-msg", "post-commit"]) {
    const path = join(hooksDir, name)
    if (existsSync(path)) installed.set(name, readFileSync(path, "utf8"))
  }
  return installed
}

// The checker block withMemoryHookChecker wrote into an omo hook, read back so a migration keeps it.
function installedChecker(installed: ReadonlyMap<string, string>): MemoryHookChecker | undefined {
  for (const script of installed.values()) {
    if (!script.includes(OMO_HOOK_MARKER)) continue
    const values = new Map([...script.matchAll(CHECKER_LINE_RE)].map((match) => [match[1], (match[2] ?? "").replaceAll("'\\''", "'")]))
    const execPath = values.get("runtime")
    const checkerScript = values.get("script")
    if (execPath !== undefined && checkerScript !== undefined) return { execPath, script: checkerScript }
  }
  return undefined
}

// A concurrent `git commit` reads either the old hook or the new one, never a half-written file.
function replaceAtomically(path: string, script: string): void {
  const temp = `${path}.omo-${process.pid}-${Date.now().toString(36)}.tmp`
  try {
    writeFileSync(temp, script, "utf8")
    chmodSync(temp, HOOK_MODE)
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
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
