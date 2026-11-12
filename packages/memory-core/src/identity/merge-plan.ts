// The read-only half of `/memory-merge` (#10070): what each source file becomes in the target.

import { GitMemoryRepo, type GitTreeBlobEntry } from "../git"
import type { MemoryIdentityPaths } from "./layout"
import { freeAsidePath, MERGED_ASIDE_ROOT } from "./merge-aside"
import { foldTreeName, isMergePathConfined, isPlainTreePath, type UnplaceableReason } from "./merge-paths"

export type MergeAction =
  | { readonly path: string; readonly action: "add"; readonly destination: string }
  | { readonly path: string; readonly action: "skip" }
  | { readonly path: string; readonly action: "keep-aside"; readonly destination: string }
  /** Left out of the merge: nothing is written for it anywhere, and the source is not marked merged. */
  | { readonly path: string; readonly action: "unplaceable"; readonly reason: UnplaceableReason }

export interface MergePlan {
  readonly sourceId: string
  readonly sourceHead: string | null
  readonly actions: readonly MergeAction[]
}

/**
 * `since` is the source head of an earlier merge into this target: only files that changed after it are
 * considered, so a rerun brings in new work without re-adding files the target deleted meanwhile.
 */
export async function planIdentityMerge(
  source: MemoryIdentityPaths,
  target: MemoryIdentityPaths,
  since?: string,
): Promise<MergePlan> {
  const sourceId = identityIdOf(source)
  const sourceRepo = new GitMemoryRepo({ dir: source.repo, agentId: sourceId })
  const targetRepo = new GitMemoryRepo({ dir: target.repo, agentId: identityIdOf(target) })
  const sourceHead = await sourceRepo.head()
  if (sourceHead === null) return { sourceId, sourceHead, actions: [] }
  const targetHead = await targetRepo.head()
  const sourceBlobs = await sourceRepo.lsTreeBlobs(sourceHead)
  const targetBlobs = new Map<string, GitTreeBlobEntry>(
    targetHead === null ? [] : (await targetRepo.lsTreeBlobs(targetHead)).map((entry) => [entry.path, entry]),
  )
  // On a case-insensitive disk (default macOS) a path that differs only in letter case is the same file.
  const targetFolded = new Set([...targetBlobs.keys()].map((path) => path.toLowerCase()))
  const mergedBefore =
    since === undefined
      ? undefined
      : new Map(
          (await sourceRepo.lsTreeBlobs(since).catch(() => [] as readonly GitTreeBlobEntry[])).map((entry) => [
            entry.path,
            entry.oid,
          ]),
        )
  const actions = [...sourceBlobs]
    .filter((entry) => !entry.path.startsWith(".") && !entry.path.startsWith(`${MERGED_ASIDE_ROOT}/`))
    .filter((entry) => mergedBefore?.get(entry.path) !== entry.oid)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry): MergeAction => {
      // A source tree is data: plumbing or another tool can name an entry `..`, `.git` or `a\b`, and such a
      // name must never become a target path (#12974 security). It is left out and named; the rest still merges.
      if (!isMergePathConfined(entry.path) || !isPlainTreePath(entry.path))
        return { path: entry.path, action: "unplaceable", reason: "not-a-plain-path" }
      const existing = targetBlobs.get(entry.path)
      if (existing?.oid === entry.oid) return { path: entry.path, action: "skip" }
      const foldedCollision = existing === undefined && targetFolded.has(entry.path.toLowerCase())
      // A disk reads `system.`, `system ` and `system:s` as `system`, so the first name is folded the way isPlainTreePath folds `.git`.
      const [first = "", ...rest] = entry.path.split("/")
      // A first name outside ASCII is never folded (case folding differs by disk: APFS and NTFS map U+017F to s),
      // so it goes aside like system/ instead of guessing how the target disk reads it.
      const inSystem = rest.length > 0 && (/[^\x00-\x7f]/u.test(first) || foldTreeName(first) === "system")
      if (existing === undefined && !foldedCollision && !inSystem) {
        return { path: entry.path, action: "add", destination: entry.path }
      }
      return {
        path: entry.path,
        action: "keep-aside",
        destination: freeAsidePath(sourceId, sourceHead, entry.path, targetBlobs, targetFolded),
      }
    })
  return { sourceId, sourceHead, actions }
}

/** Whether applying `plan` brings in every source entry, so the source may be marked merged. */
export function leavesNothingOut(plan: MergePlan): boolean {
  return plan.actions.every((action) => action.action !== "unplaceable")
}

export function identityIdOf(paths: MemoryIdentityPaths): string {
  return (
    paths.root
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .at(-1) ?? ""
  )
}
