import { join } from "node:path"
import { writeFile } from "../fs/resilient"
import type { GitExec, GitExecResult } from "../git"

const GIT_TIMEOUT_MS = 30_000

/**
 * Resolves a stopped rebase step only when every conflicted path was a pure append on both sides: the
 * base is a prefix of the parent's version (stage 2) and of the run's version (stage 3). The result is
 * the parent's content followed by the run's appended suffix. Anything else (an edit, a delete, an
 * add/add) is left unresolved so the caller aborts. Monthly facts notes are append-mostly, which is
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
    if (!parent.startsWith(base) || !run.startsWith(base)) return false
    const separator = parent.length > 0 && !parent.endsWith("\n") ? "\n" : ""
    resolved.set(path, `${parent}${separator}${run.slice(base.length)}`)
  }
  for (const [path, content] of resolved) {
    await writeFile(join(dir, path), content)
    const added = await runGit(exec, dir, ["add", "--", path])
    if (added.code !== 0) return false
  }
  return true
}

async function stage(exec: GitExec, dir: string, index: 1 | 2 | 3, path: string): Promise<string | null> {
  const shown = await runGit(exec, dir, ["show", `:${index}:${path}`])
  return shown.code === 0 ? shown.stdout : null
}

function runGit(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}
