import type { GitExec, GitExecResult } from "../git"
import { NO_AUTO_MAINTENANCE } from "../git/no-auto-maintenance"
import { resolveAppendOnlyConflicts } from "./append-conflict-resolution"
import { validateCompletion } from "./completion-validation"
import { listLines } from "./merge-conflict-detail"
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
  if (head.code !== 0 || head.stdout.trim() !== validated.tipSha) return conflict
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
        return { status: "refused", result: { outcome: "failed", detail: aborted.stderr.trim() || "Reflection rebase could not be aborted" } }
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
    return { status: "refused", result: { outcome: "failed", detail: `Rebased reflection changed paths outside its validated set: ${outside.join(", ")}` } }
  }
  return { status: "rebased", validated: { tipSha: validation.tipSha, changedPaths: validation.changedPaths } }
}

function run(exec: GitExec, cwd: string, argv: readonly string[]): Promise<GitExecResult> {
  return exec.run(argv, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
  })
}
