import { runGit, GitCommandError } from "../git/command"
import type { DeltaPatchResult } from "../git/delta"
import { errorText, nestedPath, stashPop, stashPush, summarize, withRepoLock, writeArtifacts, type ArtifactOptions, type IsolationMergeResult, type MergeState } from "./shared"

async function alreadyApplied(cwd: string, patchPath: string): Promise<boolean> {
  const reverse = await runGit(["apply", "--check", "--reverse", patchPath], { cwd, allowedExitCodes: [0, 1, 128] })
  const forward = await runGit(["apply", "--check", patchPath], { cwd, allowedExitCodes: [0, 1, 128] })
  return reverse.code === 0 && forward.code !== 0
}

export async function applyNestedPatches(repoRoot: string, delta: DeltaPatchResult, patchPaths: string[]): Promise<Pick<MergeState, "partial" | "nested_failed" | "warning">> {
  const failed: { path: string; error: string }[] = []
  const warnings: string[] = []
  for (const [index, nested] of delta.nestedPatches.entries()) {
    if (!nested.patch.trim()) continue
    const cwd = await nestedPath(repoRoot, nested.relativePath)
    try {
      if (await alreadyApplied(cwd, patchPaths[index]!)) continue
      const stashed = await stashPush(cwd)
      try {
        await runGit(["apply", "--index", "--binary", "--whitespace=nowarn", patchPaths[index]!], { cwd })
        await runGit(["commit", "-m", "chore(task): isolated nested changes"], { cwd })
      } finally {
        if (stashed) {
          const warning = await stashPop(cwd, stashed)
          if (warning) warnings.push(`${nested.relativePath}: ${warning}`)
        }
      }
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error
      failed.push({ path: nested.relativePath, error: errorText(error) })
    }
  }
  return {
    ...(failed.length ? { partial: true, nested_failed: failed } : {}),
    ...(warnings.length ? { warning: warnings.join("\n"), partial: true } : {}),
  }
}

/** Caller holds the common-directory lock. Root apply is deliberately never --3way. */
export async function applyDeltaPatchLocked(repoRoot: string, delta: DeltaPatchResult, artifacts: Awaited<ReturnType<typeof writeArtifacts>>): Promise<IsolationMergeResult> {
  if (!delta.rootPatch.trim() && !delta.nestedPatches.some(p => p.patch.trim())) {
    return summarize({ ...artifacts, changes_applied: false, kind: "no-changes" })
  }
  let kind: "applied" | "already-applied" = "applied"
  if (delta.rootPatch.trim()) {
    if (await alreadyApplied(repoRoot, artifacts.patch_path)) kind = "already-applied"
    else {
      try {
        await runGit(["apply", "--binary", "--whitespace=nowarn", artifacts.patch_path], { cwd: repoRoot })
      } catch (error) {
        if (!(error instanceof GitCommandError)) throw error
        return summarize({ ...artifacts, changes_applied: false, kind: "not-applied", conflict: error.stderr, manual_command: `git apply --3way ${artifacts.patch_path}` })
      }
    }
  }
  const nested = await applyNestedPatches(repoRoot, delta, artifacts.nested_patch_paths)
  const expected = delta.nestedPatches.filter((entry) => entry.patch.trim()).length
  if (!delta.rootPatch.trim() && expected > 0 && nested.nested_failed?.length === expected) {
    // Nothing landed anywhere: report the merge as not applied, with recovery.
    return summarize({
      ...artifacts, changes_applied: false, kind: "not-applied",
      conflict: nested.nested_failed!.map((failure) => `${failure.path}: ${failure.error}`).join("\n"),
      manual_command: `git apply --3way <nested patch>`,
      ...nested,
    })
  }
  return summarize({ ...artifacts, changes_applied: true, kind, ...nested })
}
export async function applyDeltaPatch(repoRoot: string, delta: DeltaPatchResult, options: ArtifactOptions): Promise<IsolationMergeResult> {
  const artifacts = await writeArtifacts(delta, options)
  return withRepoLock(repoRoot, () => applyDeltaPatchLocked(repoRoot, delta, artifacts), options.lockHook)
}
