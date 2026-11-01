import { join } from "node:path"
import { writeFile } from "../fs/resilient"
import type { GitExec, GitExecResult } from "../git"

const GIT_TIMEOUT_MS = 30_000

/**
 * Resolves a stopped rebase step only when every conflicted path was a pure whole-line append on both
 * sides (see combineAppends). Anything else (an edit, a delete, an add/add, a change to an unterminated
 * last line) is left unresolved so the caller aborts. Monthly facts notes are append-mostly, which is
 * why a plain replay of the run's commit conflicts at end of file (#12075).
 */
export async function resolveAppendOnlyConflicts(
  exec: GitExec,
  dir: string,
  paths: readonly string[],
): Promise<boolean> {
  if (paths.length === 0) return false
  const resolved = new Map<string, string>()
  for (const path of paths) {
    const base = await stage(exec, dir, 1, path)
    const parent = await stage(exec, dir, 2, path)
    const run = await stage(exec, dir, 3, path)
    if (base === null || parent === null || run === null) return false
    const combined = combineAppends(base, parent, run)
    if (combined === null) return false
    resolved.set(path, combined)
  }
  for (const [path, content] of resolved) {
    await writeFile(join(dir, path), content)
    const added = await runGit(exec, dir, ["add", "--", path])
    if (added.code !== 0) return false
  }
  return true
}

/**
 * Joins two appends to the same base: the parent's added lines, then the run's. Both sides must add whole
 * lines after a line boundary: the base is empty or ends with a newline, and each added suffix is empty or
 * ends with a newline. A base without a trailing newline means its last line was extended, not appended
 * to, so it is refused rather than spliced ("status: draft" -> "draft-final" + "drafted"). An identical
 * suffix on both sides is the same append and is kept once. Returns null when the change is not such an append.
 */
export function combineAppends(base: string, parent: string, run: string): string | null {
  if (base !== "" && !base.endsWith("\n")) return null
  if (!parent.startsWith(base) || !run.startsWith(base)) return null
  const parentAdded = parent.slice(base.length)
  const runAdded = run.slice(base.length)
  if (!isWholeLines(parentAdded) || !isWholeLines(runAdded)) return null
  return parentAdded === runAdded ? parent : `${parent}${runAdded}`
}

function isWholeLines(added: string): boolean {
  return added === "" || added.endsWith("\n")
}

async function stage(exec: GitExec, dir: string, index: 1 | 2 | 3, path: string): Promise<string | null> {
  const shown = await runGit(exec, dir, ["show", `:${index}:${path}`])
  return shown.code === 0 ? shown.stdout : null
}

function runGit(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}
