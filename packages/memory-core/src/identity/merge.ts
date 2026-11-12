// `/memory-merge` core (#10070): bring the memories of old identities (one per worktree or per spelling)
// into the repository identity `git` mode now resolves. The plan is read-only. Applying it is one commit
// in the target under its memory-write lock, never touches the target's `system/`, and leaves the source
// repository as it was; the source's `identity.json` records `mergedInto` and the head that was merged,
// so a repeated run is a no-op and later source commits merge incrementally.

export { applyIdentityMerge, type ApplyIdentityMergeOptions, type MergeResult } from "./merge-apply"
export { planIdentityMerge, type MergeAction, type MergePlan } from "./merge-plan"
export {
  findMergePredecessors,
  repositoryCandidateDirs,
  repositoryWorktreeDirs,
  type MergePredecessor,
  type MergePredecessors,
} from "./merge-predecessors"
