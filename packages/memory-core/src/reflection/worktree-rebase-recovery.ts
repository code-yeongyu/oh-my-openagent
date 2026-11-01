import { resolve } from "node:path"
import { existsSync } from "../fs/resilient"
import type { GitExec, GitExecResult } from "../git"
import { NO_AUTO_MAINTENANCE } from "../git/no-auto-maintenance"
import { resolveAppendOnlyConflicts } from "./append-conflict-resolution"
import { validateCompletion } from "./completion-validation"
import { boundDetail, formatPathList, listLines } from "./merge-conflict-detail"
import type { ReflectionWorktree } from "./worktree"
import type { ReflectionIntegrationResult, ValidatedReflectionTip } from "./worktree-integration"

const GIT_TIMEOUT_MS = 30_000
const MAX_REBASE_STEPS = 64

export type ReflectionRebase =
  | { readonly status: "rebased"; readonly validated: ValidatedReflectionTip }
  | { readonly status: "refused"; readonly result: ReflectionIntegrationResult }

/**
 * Replays the run's validated commits onto the parent's current HEAD inside the run worktree, then runs the
 * run's completion gate again on the rebased tip. Only a rebased tip that passes that gate and changes no
 * path outside the originally validated set comes back as mergeable.
 */
export async function rebaseValidatedTip(
  worktree: ReflectionWorktree,
  validated: ValidatedReflectionTip,
  conflictDetail: string,
): Promise<ReflectionRebase> {
  const conflict: ReflectionRebase = { status: "refused", result: { outcome: "merge_conflict", detail: conflictDetail } }
  const head = await run(worktree.exec, worktree.dir, ["rev-parse", "--verify", "HEAD"])
  if (head.code !== 0) return conflict
  if (head.stdout.trim() !== validated.tipSha && !await restoreValidatedTip(worktree, validated.tipSha)) return conflict
  const onto = (await run(worktree.exec, worktree.parent.dir, ["rev-parse", "--verify", "HEAD"])).stdout.trim()
  const upstream = (await run(worktree.exec, worktree.dir, ["merge-base", onto, validated.tipSha])).stdout.trim()
  if (!onto || !upstream) return conflict

  let step = await run(worktree.exec, worktree.dir, [...NO_AUTO_MAINTENANCE, "rebase", "--onto", onto, upstream])
  for (let round = 0; step.code !== 0; round += 1) {
    const unmerged = await run(worktree.exec, worktree.dir, ["diff", "--name-only", "--diff-filter=U"])
    const resolved = round < MAX_REBASE_STEPS
      && await resolveAppendOnlyConflicts(worktree.exec, worktree.dir, listLines(unmerged.stdout))
    if (!resolved) {
      const aborted = await run(worktree.exec, worktree.dir, ["rebase", "--abort"])
      if (aborted.code !== 0) {
        return { status: "refused", result: { outcome: "failed", detail: boundDetail(aborted.stderr) || "Reflection rebase could not be aborted" } }
      }
      return conflict
    }
    step = await run(worktree.exec, worktree.dir, [...NO_AUTO_MAINTENANCE, "rebase", "--continue"])
  }

  const validation = await validateCompletion(worktree, onto, worktree.exec)
  if (validation.status === "dirty_uncommitted" || validation.status === "failed") {
    return { status: "refused", result: { outcome: "failed", detail: `Rebased reflection failed completion validation: ${validation.detail}` } }
  }
  const outside = validation.changedPaths.filter((path) => !validated.changedPaths.includes(path))
  if (outside.length > 0) {
    return { status: "refused", result: { outcome: "failed", detail: `Rebased reflection changed paths outside its validated set: ${formatPathList(outside)}` } }
  }
  return { status: "rebased", validated: { tipSha: validation.tipSha, changedPaths: validation.changedPaths } }
}

/**
 * A finalize that crashed after its rebase but before the rebased tip was checkpointed resumes with the
 * worktree on that unrecorded tip, or still mid-rebase. That tip was never recorded, so the worktree goes
 * back to the checkpointed tip and the rebase runs again under the same gates. A HEAD that descends from the
 * checkpointed tip holds commits made after validation, and a dirty worktree holds unknown edits: both refuse.
 */
async function restoreValidatedTip(worktree: ReflectionWorktree, tipSha: string): Promise<boolean> {
  if (await rebaseInProgress(worktree)) {
    if ((await run(worktree.exec, worktree.dir, ["rebase", "--abort"])).code !== 0) return false
  }
  const head = await run(worktree.exec, worktree.dir, ["rev-parse", "--verify", "HEAD"])
  if (head.code !== 0) return false
  if (head.stdout.trim() === tipSha) return true
  if ((await run(worktree.exec, worktree.dir, ["cat-file", "-e", `${tipSha}^{commit}`])).code !== 0) return false
  if ((await run(worktree.exec, worktree.dir, ["merge-base", "--is-ancestor", tipSha, "HEAD"])).code === 0) return false
  const status = await run(worktree.exec, worktree.dir, ["status", "--porcelain"])
  if (status.code !== 0 || status.stdout.trim()) return false
  return (await run(worktree.exec, worktree.dir, ["reset", "--hard", tipSha])).code === 0
}

async function rebaseInProgress(worktree: ReflectionWorktree): Promise<boolean> {
  for (const name of ["rebase-merge", "rebase-apply"]) {
    const path = await run(worktree.exec, worktree.dir, ["rev-parse", "--git-path", name])
    if (path.code === 0 && existsSync(resolve(worktree.dir, path.stdout.trim()))) return true
  }
  return false
}

function run(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
  })
}
