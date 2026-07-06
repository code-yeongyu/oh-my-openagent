import * as childProcess from "node:child_process"

export type WorktreeDirtyLifecycle = "clean" | "dirty" | "unknown"

export interface WorktreeDirtyStatus {
  /** explicit lifecycle state from `git status --short`; never infer clean from a failed command */
  lifecycle: WorktreeDirtyLifecycle
  /** true only when `git status --short` produced any non-empty output in the worktree */
  hasLocalOnlyChanges: boolean
  /** raw `git status --short` output with trailing newline removed; "" when clean or unknown */
  statusShort: string
  /** stderr or thrown error message when lifecycle is unknown */
  errorMessage?: string
}

/**
 * Inspect a boulder worktree's filesystem lifecycle via `git status --short`.
 *
 * Returns an explicit lifecycle state:
 * - `dirty`  — `git status --short` succeeded with non-empty output (local-only changes remain).
 * - `clean`  — `git status --short` succeeded with empty output.
 * - `unknown` — the command failed (git missing, not a worktree, path removed, etc.).
 *
 * A failed command is NEVER rendered as clean; only a successful empty `git status --short`
 * may render clean. No base-branch ref is read or invented here — commit-ancestry comparison
 * stays in the prompt instructions where the agent knows the target branch.
 */
export function collectWorktreeDirtyStatus(worktreePath: string): WorktreeDirtyStatus {
  try {
    const rawOutput = childProcess.execFileSync("git", ["status", "--short"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const statusShort = rawOutput.trimEnd()
    const hasLocalOnlyChanges = statusShort.trim().length > 0
    return {
      lifecycle: hasLocalOnlyChanges ? "dirty" : "clean",
      hasLocalOnlyChanges,
      statusShort,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { lifecycle: "unknown", hasLocalOnlyChanges: false, statusShort: "", errorMessage }
  }
}
