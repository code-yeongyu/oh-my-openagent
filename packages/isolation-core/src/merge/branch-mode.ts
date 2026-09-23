import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { WorktreeBaseline } from "../git/baseline"
import { GitCommandError, runGit } from "../git/command"
import { captureDeltaPatch, type DeltaPatchResult } from "../git/delta"
import { writeSyntheticTree } from "../git/synthetic-tree"
import { errorText, stashPop, stashPush, taskBranch, withRepoLock, type LockHook, type MergeState } from "./shared"

export interface TaskBranch {
  branchName?: string
  baseSha: string
  nestedPatches: DeltaPatchResult["nestedPatches"]
}
export interface BranchOptions {
  commitMessage?: (diff: string) => Promise<string | null>
  lockHook?: LockHook
}
export class IsolationCommitReplayError extends Error {
  constructor(readonly commit: string, readonly branchName: string, readonly cause: unknown) {
    super(`Cannot replay isolation commit ${commit} onto ${branchName}: ${errorText(cause)}`)
    this.name = "IsolationCommitReplayError"
  }
}
async function output(cwd: string, args: string[]) {
  return (await runGit(args, { cwd })).stdout.toString().trim()
}
async function diff(cwd: string, base: string, head: string) {
  return (await runGit(["diff-tree", "--no-commit-id", "-r", "-p", "--binary", "--no-ext-diff", "--no-textconv", base, head], { cwd })).stdout.toString()
}
/** Replay only in a disposable index: even a failed three-way merge cannot touch user files. */
async function filteredTree(repoRoot: string, base: string, patch: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isolation-replay-"))
  const options = { cwd: repoRoot, env: { GIT_INDEX_FILE: join(dir, "index") } }
  try {
    await runGit(["read-tree", base], options)
    if (patch.trim()) {
      try {
        await runGit(["apply", "--cached", "--binary", "--whitespace=nowarn", "-"], { ...options, input: patch })
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error
        await runGit(["read-tree", base], options)
        await runGit(["apply", "--cached", "--3way", "--binary", "--whitespace=nowarn", "-"], { ...options, input: patch })
      }
    }
    return (await runGit(["write-tree"], options)).stdout.toString().trim()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
async function commitTree(repoRoot: string, branch: string, tree: string, message: string, author?: Record<string, string>): Promise<void> {
  const parent = await output(repoRoot, ["rev-parse", branch])
  const sha = (await runGit(["commit-tree", tree, "-p", parent], { cwd: repoRoot, input: message, env: author })).stdout.toString().trim()
  await runGit(["update-ref", `refs/heads/${branch}`, sha, parent], { cwd: repoRoot })
}

export async function commitToBranchLocked(isolationDir: string, repoRoot: string, id: string, baseline: WorktreeBaseline, options: BranchOptions = {}, suppliedDelta?: DeltaPatchResult): Promise<TaskBranch> {
  const branchName = taskBranch(id)
  const baseSha = baseline.root.headCommit
  const delta = suppliedDelta ?? await captureDeltaPatch(isolationDir, baseline)
  if (!delta.rootPatch.trim()) return { baseSha, nestedPatches: delta.nestedPatches }
  const head = await output(isolationDir, ["rev-parse", "HEAD"])
  // Reject rewritten/non-descendant child histories instead of importing unrelated commits.
  await runGit(["merge-base", "--is-ancestor", baseSha, head], { cwd: isolationDir })
  const dirty = [baseline.root.staged, baseline.root.unstaged, baseline.root.untrackedPatch].some(p => p.trim())
  const message = async (patch: string) => (await options.commitMessage?.(patch)) || `chore(task): ${id} leftovers`
  // Ref creation is non-forcing, including retries with a retained branch of this id.
  await runGit(["branch", branchName, baseSha], { cwd: repoRoot })
  if (!dirty && head !== baseSha) {
    await runGit(["fetch", "--no-tags", isolationDir, `HEAD:refs/heads/${branchName}`], { cwd: repoRoot })
    const leftovers = await captureDeltaPatch(isolationDir, { root: { repoRoot: isolationDir, headCommit: head, staged: "", unstaged: "", untrackedFiles: [], untrackedPatch: "" }, nested: [] })
    if (leftovers.rootPatch.trim()) {
      const tree = await writeSyntheticTree(repoRoot, head, [leftovers.rootPatch])
      await commitTree(repoRoot, branchName, tree, await message(leftovers.rootPatch))
    }
  } else {
    // Seed WIP-side blobs in both object databases. Diffing cumulative child states
    // against this tree subtracts inherited WIP even when a child used `git add .`.
    const wip = [baseline.root.staged, baseline.root.unstaged, baseline.root.untrackedPatch]
    const dirtyTree = await writeSyntheticTree(isolationDir, baseSha, wip)
    await writeSyntheticTree(repoRoot, baseSha, wip)
    const commits = (await output(isolationDir, ["rev-list", "--reverse", `${baseSha}..${head}`])).split("\n").filter(Boolean)
    let previousTree = await output(repoRoot, ["rev-parse", `${baseSha}^{tree}`])
    for (const commit of commits) {
      try {
        const patch = await diff(isolationDir, dirtyTree, `${commit}^{tree}`)
        const tree = await filteredTree(repoRoot, baseSha, patch)
        if (tree !== previousTree) {
          const details = (await runGit(["show", "-s", "--format=%an%x00%ae%x00%aI%x00%B", commit], { cwd: isolationDir })).stdout.toString().split("\0")
          await commitTree(repoRoot, branchName, tree, details[3]!, { GIT_AUTHOR_NAME: details[0]!, GIT_AUTHOR_EMAIL: details[1]!, GIT_AUTHOR_DATE: details[2]! })
        }
        previousTree = tree
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error
        throw new IsolationCommitReplayError(commit, branchName, error)
      }
    }
    try {
      const finalTree = await filteredTree(repoRoot, baseSha, delta.rootPatch)
      if (finalTree !== previousTree) {
        await commitTree(repoRoot, branchName, finalTree, await message(await diff(repoRoot, previousTree, finalTree)))
      }
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error
      throw new IsolationCommitReplayError(`${head} (leftovers)`, branchName, error)
    }
  }
  return { branchName, baseSha, nestedPatches: delta.nestedPatches }
}
export async function commitToBranch(isolationDir: string, repoRoot: string, id: string, baseline: WorktreeBaseline, options: BranchOptions = {}): Promise<TaskBranch> {
  return withRepoLock(repoRoot, () => commitToBranchLocked(isolationDir, repoRoot, id, baseline, options), options.lockHook)
}
export async function mergeTaskBranchLocked(repoRoot: string, branch: TaskBranch): Promise<MergeState> {
  if (!branch.branchName) return { changes_applied: false, kind: "no-changes" }
  const branchName = branch.branchName
  const revisions = await output(repoRoot, ["rev-list", `${branch.baseSha}..${branchName}`])
  if (!revisions) {
    await runGit(["branch", "-D", branchName], { cwd: repoRoot })
    return { changes_applied: false, kind: "no-changes" }
  }
  const stashed = await stashPush(repoRoot)
  let state: MergeState
  let warning: string | undefined
  try {
    try {
      // One sequencer invocation means --abort restores HEAD before the ENTIRE range.
      await runGit(["cherry-pick", `${branch.baseSha}..${branchName}`], { cwd: repoRoot })
      state = { changes_applied: true, kind: "branch-merged" }
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error
      await runGit(["cherry-pick", "--abort"], { cwd: repoRoot })
      state = { changes_applied: false, kind: "branch-merge-failed", branch_name: branchName, conflict: error.stderr }
    }
  } finally {
    if (stashed) warning = await stashPop(repoRoot, stashed)
  }
  if (state.changes_applied) await runGit(["branch", "-D", branchName], { cwd: repoRoot })
  return { ...state, ...(warning ? { warning } : {}) }
}
export async function mergeTaskBranch(repoRoot: string, branch: TaskBranch, options: Pick<BranchOptions, "lockHook"> = {}): Promise<MergeState> {
  return withRepoLock(repoRoot, () => mergeTaskBranchLocked(repoRoot, branch), options.lockHook)
}
