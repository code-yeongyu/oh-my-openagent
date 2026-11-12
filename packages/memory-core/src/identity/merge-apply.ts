// The writing half of `/memory-merge` (#10070): one commit in the target under its memory-write lock, never
// touching the target's `system/`, and a merge record on the source so a rerun merges only newer commits.

import { GitMemoryRepo, NoEffectiveChangesError, type GitCommitAuthor } from "../git"
import { readdir, writeFile } from "../fs/resilient"
import type { MemoryWriteLock } from "../tools/commit-write"
import type { MemoryIdentityPaths } from "./layout"
import { assertMergePathConfined, attachLeftoverDirs, createInTarget, removeCreatedDirs } from "./merge-paths"
import { identityIdOf, leavesNothingOut, planIdentityMerge, type MergeAction, type MergePlan } from "./merge-plan"
import { markIdentityMerged, readIdentityRecord } from "./record"

const MERGED_FROM_TRAILER = "Omo-Merged-From"
const MERGED_HEAD_TRAILER = "Omo-Merged-Head"

export type MergeResult = (
  | { readonly status: "merged"; readonly sha: string; readonly plan: MergePlan }
  | { readonly status: "already-merged" | "nothing-to-merge"; readonly plan: MergePlan }
) & {
  /** Directories this merge created and could not remove while rolling a write back (a link put in place of one). */
  readonly leftoverDirs?: readonly string[]
}

interface LockedOutcome {
  readonly plan: MergePlan
  readonly sha?: string
  readonly leftoverDirs?: readonly string[]
}

export interface ApplyIdentityMergeOptions {
  readonly source: MemoryIdentityPaths
  readonly target: MemoryIdentityPaths
  readonly lock: MemoryWriteLock
  readonly author: GitCommitAuthor
  /**
   * Creates the target repository when it does not exist yet, called inside the write lock. The harness
   * supplies its full bootstrap (seed files, hooks), the same one a first memory write runs, so a store
   * created by a merge is never a bare repository. Without it a missing target is refused.
   */
  readonly initTarget?: (repo: GitMemoryRepo) => Promise<unknown>
}

export async function applyIdentityMerge(options: ApplyIdentityMergeOptions): Promise<MergeResult> {
  const { source, target, lock, author } = options
  const record = await readIdentityRecord(source.root).catch(() => undefined)
  const targetId = identityIdOf(target)
  const since = record?.mergedInto === targetId ? record.mergedHead : undefined
  const preview = await planIdentityMerge(source, target, since)
  if (preview.sourceHead === null) return { status: "nothing-to-merge", plan: preview }
  if (since === preview.sourceHead) return { status: "already-merged", plan: preview }
  const sourceRepo = new GitMemoryRepo({ dir: source.repo, agentId: preview.sourceId })
  const targetRepo = new GitMemoryRepo({ dir: target.repo, agentId: targetId })
  // The plan that is written is made inside the lock: another writer may have created a path in the
  // target after the preview, and an `add` must never replace it.
  const outcome = await lock("memory-write", async (): Promise<LockedOutcome> => {
    // A repository-root identity that is new under the `git` default has no repository yet: the merge is
    // its first write, so it creates it here instead of failing every source.
    if (
      (await targetRepo.head().catch(() => null)) === null &&
      (await readdir(target.repo).catch(() => undefined)) === undefined
    ) {
      if (options.initTarget === undefined) throw new Error(`memory merge: ${targetId} has no memory repository yet`)
      await options.initTarget(targetRepo)
    }
    await targetRepo.cleanCheck()
    // Read the merge record again under the lock: a concurrent apply may have merged this source meanwhile.
    const current = await readIdentityRecord(source.root).catch(() => undefined)
    const lockedSince = current?.mergedInto === targetId ? current.mergedHead : undefined
    if (lockedSince !== undefined && lockedSince === preview.sourceHead) return { plan: { ...preview, actions: [] } }
    const plan = await planIdentityMerge(source, target, lockedSince)
    const writes = plan.actions.filter(
      (action): action is Extract<MergeAction, { action: "add" | "keep-aside" }> =>
        action.action === "add" || action.action === "keep-aside",
    )
    if (writes.length === 0 || plan.sourceHead === null) return { plan }
    const oids = new Map((await sourceRepo.lsTreeBlobs(plan.sourceHead)).map((entry) => [entry.path, entry.oid]))
    const raw = await sourceRepo.readBlobBytes(writes.map((action) => requiredOid(oids, action.path)))
    // Memory files are UTF-8 by contract; a file that is not (an image under skills/, say) is refused before
    // anything is written instead of being decoded into replacement characters in the target.
    const strict = new TextDecoder("utf-8", { fatal: true })
    const contents = new Map<string, string>()
    for (const action of writes) {
      const oid = requiredOid(oids, action.path)
      const bytes = raw.get(oid)
      if (bytes === undefined) continue
      try {
        contents.set(oid, strict.decode(bytes))
      } catch {
        throw new Error(`memory merge: ${action.path} in ${plan.sourceId} is not UTF-8 text; nothing was merged`)
      }
    }
    const destinations = writes.map((action) => action.destination)
    // Only files this merge created are rolled back; a path it refused may hold the user's own bytes.
    const written: string[] = []
    const createdDirs: string[] = []
    try {
      for (const action of writes) {
        const content = contents.get(requiredOid(oids, action.path))
        if (content === undefined)
          throw new Error(`memory merge: blob for ${action.path} could not be read from ${plan.sourceId}`)
        assertMergePathConfined(action.destination)
        const handle = await createInTarget(target.repo, action.destination, createdDirs)
        written.push(action.destination)
        try {
          await writeFile(handle, content, "utf8")
        } finally {
          await handle.close()
        }
      }
      const message = [
        `chore(memory): merge memories from ${plan.sourceId}`,
        "",
        `${MERGED_FROM_TRAILER}: ${plan.sourceId}`,
        `${MERGED_HEAD_TRAILER}: ${plan.sourceHead}`,
      ].join("\n")
      const sha = (await targetRepo.commitWrite(destinations, message, author)).sha
      // Marked before the lock is released: a crash between the commit and the mark would make a rerun plan
      // from scratch and write a second set of aside copies. A store with an entry left out stays unmarked.
      if (leavesNothingOut(plan)) await markIdentityMerged(source.root, plan.sourceId, targetId, plan.sourceHead)
      return { plan, sha }
    } catch (error) {
      await targetRepo.restorePaths(written)
      const leftover = await removeCreatedDirs(target.repo, createdDirs)
      if (error instanceof NoEffectiveChangesError) return { plan, leftoverDirs: leftover.map((dir) => dir.path) }
      attachLeftoverDirs(error, leftover)
      throw error
    }
  })
  if (outcome.sha === undefined && outcome.plan.sourceHead !== null && leavesNothingOut(outcome.plan))
    await markIdentityMerged(source.root, outcome.plan.sourceId, targetId, outcome.plan.sourceHead)
  const leftover = outcome.leftoverDirs?.length ? { leftoverDirs: outcome.leftoverDirs } : {}
  return outcome.sha === undefined
    ? { status: "nothing-to-merge", plan: outcome.plan, ...leftover }
    : { status: "merged", sha: outcome.sha, plan: outcome.plan, ...leftover }
}

function requiredOid(oids: ReadonlyMap<string, string>, path: string): string {
  const oid = oids.get(path)
  if (oid === undefined) throw new Error(`memory merge: ${path} is not in the source tree`)
  return oid
}
