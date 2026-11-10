// `/memory-merge` core (#10070): bring the memories of old identities (one per worktree or per spelling)
// into the repository identity `git` mode now resolves. The plan is read-only. Applying it is one commit
// in the target under its memory-write lock, never touches the target's `system/`, and leaves the source
// repository as it was; the source's `identity.json` records `mergedInto` and the head that was merged,
// so a repeated run is a no-op and later source commits merge incrementally.

import { dirname, join } from "node:path"

import { GitMemoryRepo, NoEffectiveChangesError, type GitCommitAuthor, type GitTreeBlobEntry } from "../git"
import { mkdir, readdir, readFile, writeFile } from "../fs/resilient"
import type { MemoryWriteLock } from "../tools/commit-write"
import { AGENTS_DIRNAME, buildIdentityPaths, type MemoryIdentityPaths } from "./layout"
import { markIdentityMerged, readIdentityRecord } from "./record"
import { resolveAutoIdentity } from "./resolve"

const MERGED_FROM_TRAILER = "Omo-Merged-From"
const MERGED_HEAD_TRAILER = "Omo-Merged-Head"
const MERGED_ASIDE_ROOT = "reference/merged"

export interface MergePredecessor {
  readonly id: string
  readonly paths: MemoryIdentityPaths
  readonly spellings: readonly string[]
  /** Set once `/memory-merge --apply` merged this store; a later run merges only newer commits. */
  readonly mergedInto?: string
  readonly mergedHead?: string
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

/**
 * `candidateDirs` covers stores written before `identity.json` existed: each directory (typically a live
 * linked worktree of the repository) is probed for a store under its path-derived id.
 */
export async function findMergePredecessors(
  memoryRoot: string,
  targetId: string,
  resolve: (spelling: string) => string,
  candidateDirs: readonly string[] = [],
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
      predecessors.push({ id, paths, spellings: record.spellings, ...(record.mergedInto === undefined ? {} : { mergedInto: record.mergedInto }), ...(record.mergedHead === undefined ? {} : { mergedHead: record.mergedHead }) })
    } else {
      unmapped.push(id)
    }
  }
  const known = new Set([targetId, ...predecessors.map((entry) => entry.id), ...unmapped])
  for (const dir of candidateDirs) {
    const id = resolveAutoIdentity(dir, { OMO_MEMORY_HOME: memoryRoot }, "path").id
    if (known.has(id)) continue
    const paths = buildIdentityPaths(memoryRoot, id)
    if ((await readdir(paths.repo).catch(() => [] as string[])).length === 0) continue
    known.add(id)
    predecessors.push({ id, paths, spellings: [dir] })
  }
  return { predecessors, unmapped }
}

const CANDIDATE_WALK_SKIP = new Set([".git", "node_modules", ".omo", "dist", "build", "target", ".next", ".turbo", ".cache", "vendor"])
const CANDIDATE_WALK_MAX_DEPTH = 6
const CANDIDATE_WALK_MAX_DIRS = 5000

/**
 * Every directory a pre-`identity.json` store may have been keyed to: the recorded spellings themselves
 * (a symlinked spelling included), the repository's live linked worktrees, and the directories inside
 * each repository root (bounded walk, build and dependency trees skipped).
 */
export async function repositoryCandidateDirs(spellings: readonly string[]): Promise<string[]> {
  const found = new Set<string>(spellings)
  const worktrees = await repositoryWorktreeDirs(spellings)
  for (const dir of worktrees) found.add(dir)
  const roots = new Set<string>()
  for (const dir of [...spellings, ...worktrees]) {
    for (let current = dir; ; current = dirname(current)) {
      if ((await readdir(join(current, ".git")).catch(() => undefined)) !== undefined || (await readFile(join(current, ".git"), "utf8").catch(() => undefined)) !== undefined) {
        roots.add(current)
        break
      }
      if (dirname(current) === current) break
    }
  }
  let budget = CANDIDATE_WALK_MAX_DIRS
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (budget <= 0 || depth > CANDIDATE_WALK_MAX_DEPTH) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || CANDIDATE_WALK_SKIP.has(entry.name)) continue
      if (budget <= 0) return
      budget -= 1
      const child = join(dir, entry.name)
      found.add(child)
      await walk(child, depth + 1)
    }
  }
  for (const root of roots) {
    found.add(root)
    await walk(root, 1)
  }
  return [...found].sort()
}

/** The live linked worktrees of each directory's repository (read from `.git/worktrees/*\/gitdir`, no `git` spawn). */
export async function repositoryWorktreeDirs(dirs: readonly string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const dir of dirs) {
    let current = dir
    for (;;) {
      const adminRoot = join(current, ".git", "worktrees")
      const names = await readdir(adminRoot).catch(() => undefined)
      if (names !== undefined) {
        for (const name of names) {
          const pointer = await readFile(join(adminRoot, name, "gitdir"), "utf8").catch(() => undefined)
          const gitFile = pointer?.split(/\r?\n/, 1)[0]?.trim()
          if (gitFile !== undefined && gitFile !== "") found.add(dirname(gitFile))
        }
        break
      }
      if (dirname(current) === current) break
      current = dirname(current)
    }
  }
  return [...found].sort()
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
  const mergedBefore = since === undefined
    ? undefined
    : new Map((await sourceRepo.lsTreeBlobs(since).catch(() => [] as readonly GitTreeBlobEntry[])).map((entry) => [entry.path, entry.oid]))
  const actions = [...sourceBlobs]
    .filter((entry) => !entry.path.startsWith(".") && !entry.path.startsWith(`${MERGED_ASIDE_ROOT}/`))
    .filter((entry) => mergedBefore?.get(entry.path) !== entry.oid)
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry): MergeAction => {
      const existing = targetBlobs.get(entry.path)
      if (existing?.oid === entry.oid) return { path: entry.path, action: "skip" }
      const foldedCollision = existing === undefined && targetFolded.has(entry.path.toLowerCase())
      if (existing === undefined && !foldedCollision && !entry.path.startsWith("system/")) {
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
  const targetId = identityIdOf(target)
  const since = record?.mergedInto === targetId ? record.mergedHead : undefined
  const preview = await planIdentityMerge(source, target, since)
  if (preview.sourceHead === null) return { status: "nothing-to-merge", plan: preview }
  if (since === preview.sourceHead) return { status: "already-merged", plan: preview }
  const sourceRepo = new GitMemoryRepo({ dir: source.repo, agentId: preview.sourceId })
  const targetRepo = new GitMemoryRepo({ dir: target.repo, agentId: targetId })
  // The plan that is written is made inside the lock: another writer may have created a path in the
  // target after the preview, and an `add` must never replace it.
  const outcome = await lock("memory-write", async (): Promise<{ readonly plan: MergePlan; readonly sha?: string }> => {
    await targetRepo.cleanCheck()
    const plan = await planIdentityMerge(source, target, since)
    const writes = plan.actions.filter((action): action is Exclude<MergeAction, { action: "skip" }> => action.action !== "skip")
    if (writes.length === 0 || plan.sourceHead === null) return { plan }
    const oids = new Map((await sourceRepo.lsTreeBlobs(plan.sourceHead)).map((entry) => [entry.path, entry.oid]))
    const contents = await sourceRepo.readBlobs(writes.map((action) => requiredOid(oids, action.path)))
    const destinations = writes.map((action) => action.destination)
    try {
      for (const action of writes) {
        const content = contents.get(requiredOid(oids, action.path))
        if (content === undefined) throw new Error(`memory merge: blob for ${action.path} could not be read from ${plan.sourceId}`)
        const destination = join(target.repo, action.destination)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, content, "utf8")
      }
      const message = [
        `chore(memory): merge memories from ${plan.sourceId}`,
        "",
        `${MERGED_FROM_TRAILER}: ${plan.sourceId}`,
        `${MERGED_HEAD_TRAILER}: ${plan.sourceHead}`,
      ].join("\n")
      return { plan, sha: (await targetRepo.commitWrite(destinations, message, author)).sha }
    } catch (error) {
      if (error instanceof NoEffectiveChangesError) {
        await targetRepo.restorePaths(destinations)
        return { plan }
      }
      await targetRepo.restorePaths(destinations)
      throw error
    }
  })
  if (outcome.plan.sourceHead !== null) await markIdentityMerged(source.root, outcome.plan.sourceId, targetId, outcome.plan.sourceHead, now)
  return outcome.sha === undefined
    ? { status: "nothing-to-merge", plan: outcome.plan }
    : { status: "merged", sha: outcome.sha, plan: outcome.plan }
}

function requiredOid(oids: ReadonlyMap<string, string>, path: string): string {
  const oid = oids.get(path)
  if (oid === undefined) throw new Error(`memory merge: ${path} is not in the source tree`)
  return oid
}

function identityIdOf(paths: MemoryIdentityPaths): string {
  return paths.root.split(/[\\/]/).filter((part) => part !== "").at(-1) ?? ""
}
