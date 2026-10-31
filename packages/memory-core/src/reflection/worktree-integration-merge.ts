import { NO_AUTO_MAINTENANCE } from "../git/no-auto-maintenance"
import type { ReflectionWorktree } from "./worktree"
import { recordStrandedMerge } from "./worktree-integration-heal"
import {
  gitOrThrow,
  isAncestor,
  isIndexLockFailure,
  optionalRevision,
  retryOnIndexLock,
  runGit,
  type IndexLockRetry,
} from "./worktree-integration-git"

interface MergeOutcome {
  readonly outcome: "merged" | "merge_conflict" | "failed"
  readonly integrationSha?: string
  readonly detail?: string
}

interface MergeRequest {
  readonly runId: string
  readonly summary: string
  readonly tipSha: string
  readonly retry: IndexLockRetry
}

type Restore = { readonly ok: true } | { readonly ok: false; readonly detail: string }

async function head(worktree: ReflectionWorktree): Promise<string> {
  return (await gitOrThrow(worktree.exec, worktree.parent.dir, ["rev-parse", "--verify", "HEAD"])).stdout.trim()
}

// A merge that stopped after writing the shared index (refused hook, conflict, killed git) is put
// back to the HEAD it started from; anything less strands the run's tree for every later writer.
async function restoreParent(worktree: ReflectionWorktree, startHead: string, retry: IndexLockRetry): Promise<Restore> {
  const { exec } = worktree
  const dir = worktree.parent.dir
  if (await head(worktree) !== startHead) return { ok: false, detail: "parent HEAD moved during the merge" }
  const dirty = async () => await optionalRevision(exec, dir, "MERGE_HEAD") !== null
    || (await worktree.parent.status()).trim() !== ""
  if (!await dirty()) return { ok: true }
  const reset = await retryOnIndexLock(retry, () => runGit(exec, dir, ["reset", "--merge", startHead]))
  if (reset.code !== 0) return { ok: false, detail: reset.stderr.trim() || "git reset --merge failed" }
  return await dirty() ? { ok: false, detail: "parent still differs from HEAD after reset" } : { ok: true }
}

export async function mergeValidatedTip(worktree: ReflectionWorktree, request: MergeRequest): Promise<MergeOutcome> {
  const { exec } = worktree
  const dir = worktree.parent.dir
  const startHead = await head(worktree)
  for (let attempt = 1; ; attempt += 1) {
    const merge = await runGit(exec, dir, [
      ...NO_AUTO_MAINTENANCE, "merge", "--no-ff", request.tipSha,
      "-m", `merge(reflection): ${request.summary}`,
      "-m", `Omo-Run: ${request.runId}`,
    ])
    if (merge.code === 0 || await isAncestor(exec, dir, request.tipSha, "HEAD")) {
      return { outcome: "merged", integrationSha: await head(worktree) }
    }
    const detail = merge.stderr.trim() || "Reflection merge failed"
    const landedMergeHead = await optionalRevision(exec, dir, "MERGE_HEAD")
    const unmerged = await runGit(exec, dir, ["diff", "--name-only", "--diff-filter=U"])
    const restored = await restoreParent(worktree, startHead, request.retry)
    if (!restored.ok) {
      await recordStrandedMerge(worktree, { head: startHead, tipSha: request.tipSha, runId: request.runId })
      return {
        outcome: "failed",
        detail: `${detail}; the parent could not be restored (${restored.detail}), so the next integration repairs it`,
      }
    }
    if (isIndexLockFailure(merge.stderr) && attempt < request.retry.attempts) {
      await request.retry.sleep(request.retry.delayMs * attempt)
      continue
    }
    if (landedMergeHead === request.tipSha || unmerged.stdout.trim()) return { outcome: "merge_conflict", detail }
    return { outcome: "failed", detail }
  }
}
