import * as childProcess from "node:child_process"

export type WorktreeDirtyLifecycle = "clean" | "dirty" | "unknown"

export interface WorktreeDirtyStatus {
  /** explicit lifecycle state; never infer clean from a failed command */
  lifecycle: WorktreeDirtyLifecycle
  /** true only when the worktree has local-only changes: tracked changes OR ignored `.omo/` state files */
  hasLocalOnlyChanges: boolean
  /** raw `git status --short` output with trailing newline removed; "" when clean or unknown */
  statusShort: string
  /** raw `git status --short --ignored .omo` output (ignored OMO state files); "" when none or unknown */
  ignoredOmoShort: string
  /** stderr or thrown error message when lifecycle is unknown */
  errorMessage?: string
}

/**
 * Inspect a boulder worktree's filesystem lifecycle via `git status --short`,
 * plus a scoped ignored-files check for `.omo/` state (Boulder state, evidence
 * ledger, plans) that `.gitignore` hides from plain status.
 *
 * Returns an explicit lifecycle state:
 * - `dirty`  — tracked changes remain (`git status --short` non-empty) OR ignored
 *              `.omo/` state files remain (`git status --short --ignored .omo` non-empty).
 * - `clean`  — both checks succeeded with empty output.
 * - `unknown` — the primary command failed (git missing, not a worktree, path removed, etc.).
 *
 * A failed command is NEVER rendered as clean. Decision rule:
 * - primary status failure → `unknown`
 * - primary dirty → `dirty` even if the ignored check fails
 * - primary clean + ignored-check failure → `unknown` (never a false clean)
 * - primary clean + ignored-check success → `clean` only when both are empty, else `dirty`
 * No base-branch ref is read or invented here.
 */
export function collectWorktreeDirtyStatus(worktreePath: string): WorktreeDirtyStatus {
  let statusShort = ""
  let ignoredOmoShort = ""
  let errorMessage: string | undefined
  let primaryFailed = false
  try {
    statusShort = childProcess
      .execFileSync("git", ["status", "--short"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      })
      .trimEnd()
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    primaryFailed = true
  }
  if (primaryFailed) {
    return { lifecycle: "unknown", hasLocalOnlyChanges: false, statusShort: "", ignoredOmoShort: "", errorMessage }
  }
  // Scoped ignored check for .omo/ state files (.gitignore hides .omo/* except .omo/rules/).
  // Rule: primary dirty → dirty regardless of ignored-check outcome; primary clean +
  // ignored-check failure → unknown (never a false clean); primary clean + ignored-check
  // success → clean only when both are empty.
  let ignoredCheckFailed = false
  let ignoredErrorMessage: string | undefined
  try {
    ignoredOmoShort = childProcess
      .execFileSync("git", ["status", "--short", "--ignored", "--", ".omo"], {
        cwd: worktreePath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      })
      .trimEnd()
  } catch (error) {
    ignoredCheckFailed = true
    ignoredErrorMessage = error instanceof Error ? error.message : String(error)
  }
  const hasTrackedChanges = statusShort.trim().length > 0
  if (hasTrackedChanges) {
    return { lifecycle: "dirty", hasLocalOnlyChanges: true, statusShort, ignoredOmoShort }
  }
  if (ignoredCheckFailed) {
    return {
      lifecycle: "unknown",
      hasLocalOnlyChanges: false,
      statusShort,
      ignoredOmoShort: "",
      errorMessage: `ignored .omo check failed: ${ignoredErrorMessage}`,
    }
  }
  const hasIgnoredOmo = ignoredOmoShort.trim().length > 0
  return {
    lifecycle: hasIgnoredOmo ? "dirty" : "clean",
    hasLocalOnlyChanges: hasIgnoredOmo,
    statusShort,
    ignoredOmoShort,
  }
}
