// Which stores `/memory-merge` offers (#10070): old identities whose recorded spellings now resolve to the
// target, plus pre-`identity.json` stores found under the repository's directories and live worktrees.

import { basename, dirname, isAbsolute, join, resolve } from "node:path"

import { readdir, readFile } from "../fs/resilient"
import { AGENTS_DIRNAME, buildIdentityPaths, type MemoryIdentityPaths } from "./layout"
import { readIdentityRecord } from "./record"
import { resolveAutoIdentity } from "./resolve"

export interface MergePredecessor {
  readonly id: string
  readonly paths: MemoryIdentityPaths
  readonly spellings: readonly string[]
  /** Set once `/memory-merge --apply` merged this store; a later run merges only newer commits. */
  readonly mergedInto?: string
  readonly mergedHead?: string
  /** Paths that merge left out; while any remain the store is not fully merged. */
  readonly pendingPaths?: readonly string[]
}

export interface MergePredecessors {
  readonly predecessors: readonly MergePredecessor[]
  /** Identities with a record none of whose spellings resolves to the target; listed, never merged. */
  readonly unmapped: readonly string[]
}

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
        ...(record.pendingPaths === undefined ? {} : { pendingPaths: record.pendingPaths }),
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
      ...(record?.pendingPaths === undefined ? {} : { pendingPaths: record.pendingPaths }),
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
      // git writes this pointer with forward slashes on Windows, and as a path relative to its own directory under
      // worktree.useRelativePaths (git >= 2.48): resolve it against that directory so every entry is absolute in the platform spelling.
      if (gitFile !== undefined && gitFile !== "") found.add(resolve(join(common, "worktrees", name), dirname(gitFile)))
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
