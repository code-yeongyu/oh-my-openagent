// `/memory-merge` core (#10070): bring the memories of old identities (one per worktree or per spelling)
// into the repository identity `git` mode now resolves. The plan is read-only. Applying it is one commit
// in the target under its memory-write lock, never touches the target's `system/`, and leaves the source
// repository as it was; the source's `identity.json` records `mergedInto` and the head that was merged,
// so a repeated run is a no-op and later source commits merge incrementally.

import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor, type GitTreeBlobEntry } from "../git"
import { mkdir, readdir, writeFile } from "../fs/resilient"
import type { MemoryWriteLock } from "../tools/commit-write"
import { AGENTS_DIRNAME, buildIdentityPaths, type MemoryIdentityPaths } from "./layout"
import { markIdentityMerged, readIdentityRecord } from "./record"

export const MERGED_FROM_TRAILER = "Omo-Merged-From"
export const MERGED_HEAD_TRAILER = "Omo-Merged-Head"
const MERGED_ASIDE_ROOT = "reference/merged"

export interface MergePredecessor {
  readonly id: string
  readonly paths: MemoryIdentityPaths
  readonly spellings: readonly string[]
}

export interface MergePredecessors {
  readonly predecessors: readonly MergePredecessor[]
  /** Identities with a record none of whose spellings resolves to the target; listed, never merged. */
  readonly unmapped: readonly string[]
}

export type MergeAction =
  | { readonly path: string; readonly action: "add"; readonly destination: string }
  | { readonly path: string; readonly action: "skip" }
  | { readonly path: string; readonly action: "keep-aside"; readonly destination: string }

export interface MergePlan {
  readonly sourceId: string
  readonly sourceHead: string | null
  readonly actions: readonly MergeAction[]
}

export type MergeResult =
  | { readonly status: "merged"; readonly sha: string; readonly plan: MergePlan }
  | { readonly status: "already-merged" | "nothing-to-merge"; readonly plan: MergePlan }

export async function findMergePredecessors(
  memoryRoot: string,
  targetId: string,
  resolve: (spelling: string) => string,
): Promise<MergePredecessors> {
  const agentsDir = join(memoryRoot, AGENTS_DIRNAME)
  const ids = (await readdir(agentsDir).catch(() => [] as string[])).filter((id) => id !== targetId).sort()
  const predecessors: MergePredecessor[] = []
  const unmapped: string[] = []
  for (const id of ids) {
    const paths = buildIdentityPaths(memoryRoot, id)
    const record = await readIdentityRecord(paths.root).catch(() => undefined)
    if (record === undefined || record.spellings.length === 0) continue
    if (record.spellings.some((spelling) => resolve(spelling) === targetId)) {
      predecessors.push({ id, paths, spellings: record.spellings })
    } else {
      unmapped.push(id)
    }
  }
  return { predecessors, unmapped }
}

export async function planIdentityMerge(source: MemoryIdentityPaths, target: MemoryIdentityPaths): Promise<MergePlan> {
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
  const actions = [...sourceBlobs]
    .filter((entry) => !entry.path.startsWith(".") && !entry.path.startsWith(`${MERGED_ASIDE_ROOT}/`))
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry): MergeAction => {
      const existing = targetBlobs.get(entry.path)
      if (existing?.oid === entry.oid) return { path: entry.path, action: "skip" }
      if (existing === undefined && !entry.path.startsWith("system/")) {
        return { path: entry.path, action: "add", destination: entry.path }
      }
      return { path: entry.path, action: "keep-aside", destination: `${MERGED_ASIDE_ROOT}/${sourceId}/${entry.path}` }
    })
  return { sourceId, sourceHead, actions }
}

export interface ApplyIdentityMergeOptions {
  readonly source: MemoryIdentityPaths
  readonly target: MemoryIdentityPaths
  readonly lock: MemoryWriteLock
  readonly author: GitCommitAuthor
  readonly now: number
}

export async function applyIdentityMerge(options: ApplyIdentityMergeOptions): Promise<MergeResult> {
  const { source, target, lock, author, now } = options
  const record = await readIdentityRecord(source.root).catch(() => undefined)
  const plan = await planIdentityMerge(source, target)
  const targetId = identityIdOf(target)
  if (plan.sourceHead !== null && record?.mergedInto === targetId && record.mergedHead === plan.sourceHead) {
    return { status: "already-merged", plan }
  }
  const writes = plan.actions.filter((action): action is Exclude<MergeAction, { action: "skip" }> => action.action !== "skip")
  if (plan.sourceHead === null) return { status: "nothing-to-merge", plan }
  const sourceRepo = new GitMemoryRepo({ dir: source.repo, agentId: plan.sourceId })
  const targetRepo = new GitMemoryRepo({ dir: target.repo, agentId: targetId })
  let sha: string | undefined
  if (writes.length > 0) {
    const oids = new Map((await sourceRepo.lsTreeBlobs(plan.sourceHead)).map((entry) => [entry.path, entry.oid]))
    const contents = await sourceRepo.readBlobs(writes.map((action) => oids.get(action.path) ?? ""))
    sha = await lock("memory-write", async () => {
      await targetRepo.cleanCheck()
      for (const action of writes) {
        const destination = join(target.repo, action.destination)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, contents.get(oids.get(action.path) ?? "") ?? "", "utf8")
      }
      const message = [
        `chore(memory): merge memories from ${plan.sourceId}`,
        "",
        `${MERGED_FROM_TRAILER}: ${plan.sourceId}`,
        `${MERGED_HEAD_TRAILER}: ${plan.sourceHead}`,
      ].join("\n")
      return (await targetRepo.commitWrite(writes.map((action) => action.destination), message, author)).sha
    })
  }
  await markIdentityMerged(source.root, plan.sourceId, targetId, plan.sourceHead, now)
  return sha === undefined ? { status: "nothing-to-merge", plan } : { status: "merged", sha, plan }
}

function identityIdOf(paths: MemoryIdentityPaths): string {
  return paths.root.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? ""
}
