import type { WorktreeBaseline } from "../git/baseline"
import { captureDeltaPatch, type DeltaPatchResult } from "../git/delta"
import { IsolationCommitReplayError, commitToBranchLocked, mergeTaskBranchLocked, type BranchOptions } from "./branch-mode"
import { applyDeltaPatchLocked, applyNestedPatches } from "./patch-mode"
import { summarize, withRepoLock, writeArtifacts, type ArtifactOptions, type IsolationMergeResult } from "./shared"

export * from "./shared"
export { applyDeltaPatch } from "./patch-mode"
export { commitToBranch, mergeTaskBranch, IsolationCommitReplayError } from "./branch-mode"
export type { TaskBranch, BranchOptions } from "./branch-mode"
export interface IsolationMergeOptions extends ArtifactOptions, BranchOptions {
  mode: "patch" | "branch"
  apply: boolean
  repoRoot: string
  isolationDir: string
  baseline: WorktreeBaseline
  delta?: DeltaPatchResult
}
/** Never tears down isolation: callers retain it if artifact writing or replay fails. */
export async function mergeIsolatedChanges(options: IsolationMergeOptions): Promise<IsolationMergeResult> {
  const delta = options.delta ?? await captureDeltaPatch(options.isolationDir, options.baseline)
  const artifacts = await writeArtifacts(delta, options)
  if (!options.apply) return summarize({ ...artifacts, changes_applied: false, kind: "retained" })
  return withRepoLock(options.repoRoot, async () => {
    if (options.mode === "patch") return applyDeltaPatchLocked(options.repoRoot, delta, artifacts)
    try {
      const branch = await commitToBranchLocked(options.isolationDir, options.repoRoot, options.id, options.baseline, options, delta)
      const state = await mergeTaskBranchLocked(options.repoRoot, branch)
      if (state.kind === "branch-merge-failed") return summarize({ ...artifacts, ...state })
      const nested = await applyNestedPatches(options.repoRoot, delta, artifacts.nested_patch_paths)
      return summarize({ ...artifacts, ...state, ...(delta.nestedPatches.length && !branch.branchName ? { kind: "applied" as const, changes_applied: true } : {}), ...nested })
    } catch (error) {
      if (!(error instanceof IsolationCommitReplayError)) throw error
      return summarize({ ...artifacts, changes_applied: false, kind: "branch-merge-failed", branch_name: error.branchName, conflict: error.message })
    }
  }, options.lockHook)
}
