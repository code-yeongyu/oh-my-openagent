import { join } from "node:path"
import { captureRepoBaseline, type RepoBaseline, type WorktreeBaseline } from "./baseline"
import { nestedPath } from "../merge/shared"
import { exists, runGit } from "./command"
import { writeSyntheticTree } from "./synthetic-tree"

export interface DeltaPatchResult {
  rootPatch: string
  nestedPatches: { relativePath: string; patch: string }[]
}
async function diffTrees(repoRoot: string, base: string, head: string): Promise<string> {
  return (await runGit(["diff-tree", "--no-commit-id", "-r", "-p", "--binary", "--no-ext-diff", "--no-textconv", base, head], { cwd: repoRoot })).stdout.toString()
}
async function captureRepoDeltaPatch(repoDir: string, baseline: RepoBaseline): Promise<string> {
  const current = await captureRepoBaseline(repoDir)
  let committedPatch = ""
  if (current.headCommit && current.headCommit !== baseline.headCommit) {
    const base = baseline.headCommit || await writeSyntheticTree(repoDir, "", [])
    committedPatch = await diffTrees(repoDir, base, current.headCommit)
  }
  // Render in the source object database: a copied child's new commits need not exist there.
  const baselineTree = await writeSyntheticTree(baseline.repoRoot, baseline.headCommit, [baseline.staged, baseline.unstaged, baseline.untrackedPatch])
  const currentTree = await writeSyntheticTree(baseline.repoRoot, baseline.headCommit, [
    committedPatch, current.staged, current.unstaged, current.untrackedPatch,
  ])
  return diffTrees(baseline.repoRoot, baselineTree, currentTree)
}
export async function captureDeltaPatch(isolationDir: string, baseline: WorktreeBaseline): Promise<DeltaPatchResult> {
  const rootPatch = await captureRepoDeltaPatch(isolationDir, baseline.root)
  const nestedPatches: DeltaPatchResult["nestedPatches"] = []
  for (const { relativePath, baseline: nested } of baseline.nested) {
    // The baseline's repository path is a mutation target (synthetic trees write
    // into its object database), so it must still canonically sit under the root.
    await nestedPath(baseline.root.repoRoot, relativePath)
    const dir = join(isolationDir, relativePath)
    if (!(await exists(join(dir, ".git")))) {
      // A baseline-listed repository absent from the isolation means the isolated
      // tree is incomplete; silently treating it as an empty delta would drop work.
      throw new Error(`baseline nested repository missing from isolation: ${relativePath}`)
    }
    const patch = await captureRepoDeltaPatch(dir, nested)
    if (patch.trim()) nestedPatches.push({ relativePath, patch })
  }
  return { rootPatch, nestedPatches }
}
