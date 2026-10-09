import { GIT_TIMEOUT_MS } from "../constants"
import type { PanelGitStatus } from "../sections/files"
import { mergeGitDeltas, parseNumstatZ, parsePorcelainZ } from "./parse"

export interface PanelExecResult {
  readonly stdout: string
  readonly code: number
}

/** The host's `exec`, narrowed to what the git reads need. */
export type PanelExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<PanelExecResult>

/**
 * Working-copy status, straight from git. Three machine-readable reads in parallel: the
 * states, and the line counts on each side of the index. Everything is `-z`, so a path
 * with a space or a quote arrives intact.
 */
export async function readGitStatus(exec: PanelExec, root: string): Promise<PanelGitStatus | undefined> {
  const run = (args: string[]): Promise<PanelExecResult | undefined> =>
    exec("git", args, { cwd: root, timeout: GIT_TIMEOUT_MS }).catch(() => undefined)
  const [status, unstaged, staged] = await Promise.all([
    run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    run(["diff", "--numstat", "-z"]),
    run(["diff", "--cached", "--numstat", "-z"]),
  ])
  // No status means no section: a partial answer would misreport a clean tree.
  if (status === undefined || status.code !== 0) return undefined
  return {
    root,
    files: mergeGitDeltas(
      parsePorcelainZ(status.stdout),
      parseNumstatZ(unstaged?.stdout ?? ""),
      parseNumstatZ(staged?.stdout ?? ""),
    ),
  }
}
