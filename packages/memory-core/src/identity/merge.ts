// `/memory-merge` core (#10070): bring the memories of old identities (one per worktree or per spelling)
// into the repository identity `git` mode now resolves. The plan is read-only. Applying it is one commit
// in the target under its memory-write lock, never touches the target's `system/`, and leaves the source
// repository as it was; the source's `identity.json` records `mergedInto` and the head that was merged,
// so a repeated run is a no-op and later source commits merge incrementally.

import { basename, dirname, isAbsolute, join, resolve } from "node:path"

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
    // An explicit `memory.agent` profile is a cross-project store the user named on purpose; it is never a
    // fragment of the repository it happened to be used from.
    if (record === undefined || record.spellings.length === 0 || record.kind !== "auto") continue
    if (record.spellings.some((spelling) => resolve(spelling) === targetId)) {
      predecessors.push({
        id,
        paths,
        spellings: record.spellings,
        ...(record.mergedInto === undefined ? {} : { mergedInto: record.mergedInto }),
        ...(record.mergedHead === undefined ? {} : { mergedHead: record.mergedHead }),
      })
    } else {
      unmapped.push(id)
    }
  }
  const known = new Set([targetId, ...predecessors.map((entry) => entry.id), ...unmapped])
  for (const dir of candidateDirs) {
    // A directory keyed elsewhere today (a nested repository or submodule) holds another project's store.
    if (resolve(dir) !== targetId) continue
    const id = resolveAutoIdentity(dir, { OMO_MEMORY_HOME: memoryRoot }, "path").id
    if (known.has(id)) continue
    const paths = buildIdentityPaths(memoryRoot, id)
    if ((await readdir(paths.repo).catch(() => [] as string[])).length === 0) continue
    known.add(id)
    const record = await readIdentityRecord(paths.root).catch(() => undefined)
    // The first loop already drops an explicit profile. A path-derived directory can carry one too
    // (the profile name hashed like that directory); candidate discovery must not offer it either.
    if (record?.kind === "explicit") continue
    predecessors.push({
      id,
      paths,
      spellings: [dir],
      ...(record?.mergedInto === undefined ? {} : { mergedInto: record.mergedInto }),
      ...(record?.mergedHead === undefined ? {} : { mergedHead: record.mergedHead }),
    })
  }
  return { predecessors, unmapped }
}

const CANDIDATE_WALK_SKIP = new Set([
  ".git",
  "node_modules",
  ".omo",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".cache",
  "vendor",
])
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
      if (
        (await readdir(join(current, ".git")).catch(() => undefined)) !== undefined ||
        (await readFile(join(current, ".git"), "utf8").catch(() => undefined)) !== undefined
      ) {
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
    const common = await commonGitDir(dir)
    if (common === undefined) continue
    // The main working tree owns the common `.git`; a linked worktree outside the repository (Desktop keeps
    // thread worktrees under its own folder) reaches it only through its `.git` file.
    if (basename(common) === ".git") found.add(resolve(dirname(common)))
    for (const name of await readdir(join(common, "worktrees")).catch(() => [] as string[])) {
      const pointer = await readFile(join(common, "worktrees", name, "gitdir"), "utf8").catch(() => undefined)
      const gitFile = pointer?.split(/\r?\n/, 1)[0]?.trim()
      // git writes this pointer with forward slashes on Windows; resolve() gives every entry the platform spelling.
      if (gitFile !== undefined && gitFile !== "") found.add(resolve(dirname(gitFile)))
    }
  }
  return [...found].sort()
}

/** The repository's common git directory for `dir` or its nearest ancestor checkout; no `git` spawn. */
async function commonGitDir(dir: string): Promise<string | undefined> {
  for (let current = dir; ; current = dirname(current)) {
    const dotGit = join(current, ".git")
    if ((await readdir(dotGit).catch(() => undefined)) !== undefined) return dotGit
    const pointer = (await readFile(dotGit, "utf8").catch(() => undefined))?.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim()
    if (pointer !== undefined) {
      const gitDir = isAbsolute(pointer) ? pointer : join(current, pointer)
      const commonPointer = (await readFile(join(gitDir, "commondir"), "utf8").catch(() => undefined))?.trim()
      return commonPointer === undefined || commonPointer === ""
        ? gitDir
        : isAbsolute(commonPointer)
          ? commonPointer
          : join(gitDir, commonPointer)
    }
    if (dirname(current) === current) return undefined
  }
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
      const existing = targetBlobs.get(entry.path)
      if (existing?.oid === entry.oid) return { path: entry.path, action: "skip" }
      const foldedCollision = existing === undefined && targetFolded.has(entry.path.toLowerCase())
      if (existing === undefined && !foldedCollision && !entry.path.toLowerCase().startsWith("system/")) {
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
  const outcome = await lock("memory-write", async (): Promise<{ readonly plan: MergePlan; readonly sha?: string }> => {
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
      (action): action is Exclude<MergeAction, { action: "skip" }> => action.action !== "skip",
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
    try {
      for (const action of writes) {
        const content = contents.get(requiredOid(oids, action.path))
        if (content === undefined)
          throw new Error(`memory merge: blob for ${action.path} could not be read from ${plan.sourceId}`)
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
      const sha = (await targetRepo.commitWrite(destinations, message, author)).sha
      // Marked before the lock is released: a crash between the commit and the mark would make a rerun plan
      // from scratch and write a second set of aside copies.
      await markIdentityMerged(source.root, plan.sourceId, targetId, plan.sourceHead)
      return { plan, sha }
    } catch (error) {
      if (error instanceof NoEffectiveChangesError) {
        await targetRepo.restorePaths(destinations)
        return { plan }
      }
      await targetRepo.restorePaths(destinations)
      throw error
    }
  })
  if (outcome.sha === undefined && outcome.plan.sourceHead !== null)
    await markIdentityMerged(source.root, outcome.plan.sourceId, targetId, outcome.plan.sourceHead)
  return outcome.sha === undefined
    ? { status: "nothing-to-merge", plan: outcome.plan }
    : { status: "merged", sha: outcome.sha, plan: outcome.plan }
}

/**
 * The aside copy of `path`. A rerun whose usual aside path is already taken in the target (the user may
 * have edited that copy) gets a path keyed by the source head, so no committed target file is replaced.
 */
function freeAsidePath(
  sourceId: string,
  sourceHead: string,
  path: string,
  targetBlobs: ReadonlyMap<string, GitTreeBlobEntry>,
  targetFolded: ReadonlySet<string>,
): string {
  const taken = (candidate: string) => targetBlobs.has(candidate) || targetFolded.has(candidate.toLowerCase())
  const usual = `${MERGED_ASIDE_ROOT}/${sourceId}/${path}`
  if (!taken(usual)) return usual
  const keyed = `${MERGED_ASIDE_ROOT}/${sourceId}@${sourceHead.slice(0, 12)}/${path}`
  if (!taken(keyed)) return keyed
  for (let suffix = 2; ; suffix += 1) {
    const numbered = `${MERGED_ASIDE_ROOT}/${sourceId}@${sourceHead.slice(0, 12)}-${suffix}/${path}`
    if (!taken(numbered)) return numbered
  }
}

function requiredOid(oids: ReadonlyMap<string, string>, path: string): string {
  const oid = oids.get(path)
  if (oid === undefined) throw new Error(`memory merge: ${path} is not in the source tree`)
  return oid
}

function identityIdOf(paths: MemoryIdentityPaths): string {
  return (
    paths.root
      .split(/[\\/]/)
      .filter((part) => part !== "")
      .at(-1) ?? ""
  )
}
