// The read-only half of `/memory-merge` (#10070): what each source file becomes in the target.

import { GitMemoryRepo, type GitTreeBlobEntry } from "../git"
import type { MemoryIdentityPaths } from "./layout"
import { freeAsidePath, MERGED_ASIDE_ROOT } from "./merge-aside"
import { foldTreeName, isMergePathConfined, isPlainTreePath, type UnplaceableReason } from "./merge-paths"

export type MergeAction =
  | { readonly path: string; readonly action: "add"; readonly destination: string }
  /**
   * Nothing to write: the target already holds this content, or (with a reason) an aside copy this store kept
   * from an earlier merge into it, which is never merged again so aside copies do not nest.
   */
  | { readonly path: string; readonly action: "skip"; readonly reason?: "earlier-aside-copy" }
  | { readonly path: string; readonly action: "keep-aside"; readonly destination: string }
  /** Left out of the merge: nothing is written for it anywhere, and its path stays pending in the merge record. */
  | { readonly path: string; readonly action: "unplaceable"; readonly reason: UnplaceableReason }

export interface MergePlan {
  readonly sourceId: string
  readonly sourceHead: string | null
  readonly actions: readonly MergeAction[]
}

/**
 * `since` is the source head of an earlier merge into this target: only files that changed after it are
 * considered, so a rerun brings in new work without re-adding files the target deleted meanwhile.
 * `pending` are the paths that merge left out; they are considered again even when unchanged.
 */
export async function planIdentityMerge(
  source: MemoryIdentityPaths,
  target: MemoryIdentityPaths,
  since?: string,
  pending: readonly string[] = [],
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
  const stillPending = new Set(pending)
  const actions = [...sourceBlobs]
    .filter((entry) => mergedBefore?.get(entry.path) !== entry.oid || stillPending.has(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry): MergeAction => {
      // A source tree is data: plumbing or another tool can name an entry `..`, `.git` or `a\b`, and a name
      // starting with `.` at any depth configures the repository or the subtree it sits in (`.gitignore`,
      // `.gitattributes` set ignore, eol and working-tree-encoding rules) or climbs out of it. None may become a
      // target path (#12974 security): it is left out and named, and the rest still merges. This runs before
      // every other rule, so no such entry is ever reported as anything but left out.
      const hasDotName = entry.path.split("/").some((name) => name.startsWith("."))
      if (hasDotName || !isMergePathConfined(entry.path) || !isPlainTreePath(entry.path))
        return { path: entry.path, action: "unplaceable", reason: "not-a-plain-path" }
      if (entry.path.startsWith(`${MERGED_ASIDE_ROOT}/`))
        return { path: entry.path, action: "skip", reason: "earlier-aside-copy" }
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
      const destination = freeAsidePath(sourceId, sourceHead, entry, targetBlobs, targetFolded)
      return destination === undefined
        ? { path: entry.path, action: "skip" }
        : { path: entry.path, action: "keep-aside", destination }
    })
  return { sourceId, sourceHead, actions }
}

/** The source paths `plan` leaves out, sorted: what the merge record keeps pending for the next run. */
export function pendingPathsOf(plan: MergePlan): string[] {
  return plan.actions.flatMap((action) => (action.action === "unplaceable" ? [action.path] : [])).sort()
}

/** `plan` with each entry in `leftOut` (keyed by source path) turned into an `unplaceable` action. */
export function leaveOut(plan: MergePlan, leftOut: ReadonlyMap<string, UnplaceableReason>): MergePlan {
  if (leftOut.size === 0) return plan
  const actions = plan.actions.map((action): MergeAction => {
    const reason = leftOut.get(action.path)
    return reason === undefined ? action : { path: action.path, action: "unplaceable", reason }
  })
  return { ...plan, actions }
}

export function identityIdOf(paths: MemoryIdentityPaths): string {
  return (
    paths.root
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .at(-1) ?? ""
  )
}
