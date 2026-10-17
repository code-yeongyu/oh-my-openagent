// Reflection leftovers outlive the run that owned them: a killed supervisor, a torn-down
// worktree, or a crash between `git worktree add` and the run ledger all leave a registered
// worktree, a `<epoch>-<runId>` directory, or a `memory/reflection-*` branch behind. Finalization
// only cleans resources reachable from a run directory, so this sweep is the only path that
// reclaims the rest. Ownership is decided by run id and age alone: anything a live run could
// still be using, and anything younger than the grace window, is never touched.

import { existsSync, readdir, rm } from "../fs/resilient"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { createNodeGitExec, type GitExec, type GitMemoryRepo } from "../git"
import { discardReflectionWorktree } from "./worktree"

const GIT_TIMEOUT_MS = 30_000
const REFLECTION_BRANCH_PREFIX = "memory/reflection-"
const LEGACY_BRANCH_PREFIX = "reflection/run-"

/** Covers the window between a prelaunch directory and its ledger, plus clock skew. */
export const REFLECTION_ORPHAN_GRACE_MS = 15 * 60_000

export interface RegisteredReflectionWorktree {
  readonly dir: string
  readonly branch?: string
  readonly present: boolean
}

export interface ReflectionLeftovers {
  readonly registeredWorktrees: readonly RegisteredReflectionWorktree[]
  readonly strayDirs: readonly string[]
  readonly branches: readonly string[]
}

export interface ReflectionOrphanSelection {
  readonly liveRunIds: ReadonlySet<string>
  readonly now: number
  readonly graceMs?: number
}

export interface ReflectionOrphanSweepOptions extends ReflectionOrphanSelection {
  readonly exec?: GitExec
}

export interface ReflectionOrphanReceipt {
  readonly kind: "worktree" | "directory" | "branch"
  readonly target: string
  readonly removed: boolean
  readonly detail?: string
}

export async function listReflectionLeftovers(
  repo: GitMemoryRepo,
  worktreesDir: string,
  exec: GitExec = createNodeGitExec(),
): Promise<ReflectionLeftovers> {
  const root = resolve(worktreesDir)
  const listed = await git(exec, repo.dir, ["worktree", "list", "--porcelain"])
  const registeredWorktrees = parseRegisteredWorktrees(listed.stdout).filter((worktree) => isInside(root, worktree.dir))
  const registered = new Set(registeredWorktrees.map((worktree) => worktree.dir))
  const strayDirs = (await directoryNames(root))
    .filter((name) => /^\d+-/.test(name))
    .map((name) => join(root, name))
    .filter((dir) => !registered.has(dir))
  const refs = await git(exec, repo.dir, [
    "for-each-ref",
    "--format=%(refname:short)",
    `refs/heads/${REFLECTION_BRANCH_PREFIX}*`,
    `refs/heads/${LEGACY_BRANCH_PREFIX}*`,
  ])
  const branches = refs.stdout.split(/\r?\n/).map((line) => line.trim()).filter(isReflectionBranch)
  return { registeredWorktrees, strayDirs, branches }
}

/** Pure ownership decision over already-collected leftovers, so the policy is testable on its own. */
export function selectReflectionOrphans(
  leftovers: ReflectionLeftovers,
  selection: ReflectionOrphanSelection,
): ReflectionLeftovers {
  const graceMs = selection.graceMs ?? REFLECTION_ORPHAN_GRACE_MS
  const isOrphan = (name: string, present: boolean): boolean => {
    const owner = parseReflectionOwner(name)
    if (owner === undefined || isLive(selection.liveRunIds, owner.runId)) return false
    // A registration whose directory is gone can only be pruned, never resumed.
    if (!present) return true
    return owner.epoch === undefined || owner.epoch <= selection.now - graceMs
  }
  return {
    registeredWorktrees: leftovers.registeredWorktrees
      .filter((worktree) => isOrphan(basename(worktree.dir), worktree.present)),
    strayDirs: leftovers.strayDirs.filter((dir) => isOrphan(basename(dir), true)),
    branches: leftovers.branches.filter((branch) => isOrphan(branch, true)),
  }
}

/** One failing item never aborts the sweep: every attempt reports its own receipt. */
export async function sweepReflectionOrphans(
  repo: GitMemoryRepo,
  worktreesDir: string,
  options: ReflectionOrphanSweepOptions,
): Promise<readonly ReflectionOrphanReceipt[]> {
  const exec = options.exec ?? createNodeGitExec()
  const root = resolve(worktreesDir)
  const orphans = selectReflectionOrphans(await listReflectionLeftovers(repo, root, exec), options)
  const receipts: ReflectionOrphanReceipt[] = []
  const discarded = new Set<string>()

  for (const worktree of orphans.registeredWorktrees) {
    const branch = worktree.branch ?? `${REFLECTION_BRANCH_PREFIX}${basename(worktree.dir)}`
    discarded.add(branch)
    receipts.push(await attempt("worktree", worktree.dir, async () => {
      const cleanup = await discardReflectionWorktree(repo, worktree.dir, branch, exec)
      return cleanup.worktreeRemoved && cleanup.branchRemoved
    }))
  }
  for (const dir of orphans.strayDirs) {
    receipts.push(await attempt("directory", dir, async () => {
      if (!isInside(root, resolve(dir))) throw new Error(`Refusing to remove ${dir} outside ${root}`)
      await rm(dir, { recursive: true, force: true })
      return !existsSync(dir)
    }))
  }
  if (orphans.strayDirs.length > 0) await run(exec, repo.dir, ["worktree", "prune"])
  for (const branch of orphans.branches) {
    if (discarded.has(branch)) continue
    receipts.push(await attempt("branch", branch, async () => {
      await run(exec, repo.dir, ["branch", "-D", branch])
      return (await run(exec, repo.dir, ["show-ref", "--verify", `refs/heads/${branch}`])).code !== 0
    }))
  }
  return receipts
}

interface ReflectionOwner {
  readonly runId: string
  readonly epoch?: number
}

/**
 * `<epoch>-<runId>` directories and `memory/reflection-<epoch>-<runId>` branches carry their own
 * age; legacy `reflection/run-<n>` branches predate the epoch convention and get no grace.
 */
function parseReflectionOwner(name: string): ReflectionOwner | undefined {
  if (name.startsWith(LEGACY_BRANCH_PREFIX)) return { runId: name.slice("reflection/".length) }
  const suffix = name.startsWith(REFLECTION_BRANCH_PREFIX) ? name.slice(REFLECTION_BRANCH_PREFIX.length) : name
  const parsed = /^(\d+)-(.+)$/.exec(suffix)
  return parsed === null ? undefined : { runId: parsed[2] as string, epoch: Number(parsed[1]) }
}

/** Legacy branches were recorded as both `run-<n>` and `reflection-run-<n>`; either claim protects. */
function isLive(liveRunIds: ReadonlySet<string>, runId: string): boolean {
  return liveRunIds.has(runId) || liveRunIds.has(`reflection-${runId}`)
}

function isReflectionBranch(branch: string): boolean {
  return branch.startsWith(REFLECTION_BRANCH_PREFIX) || branch.startsWith(LEGACY_BRANCH_PREFIX)
}

function parseRegisteredWorktrees(porcelain: string): RegisteredReflectionWorktree[] {
  const worktrees: RegisteredReflectionWorktree[] = []
  let dir: string | undefined
  let branch: string | undefined
  const flush = () => {
    if (dir !== undefined) worktrees.push({ dir, ...(branch === undefined ? {} : { branch }), present: existsSync(dir) })
    dir = undefined
    branch = undefined
  }
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      flush()
      dir = resolve(line.slice("worktree ".length).trim())
    } else if (line.startsWith("branch refs/heads/")) {
      branch = line.slice("branch refs/heads/".length).trim()
    }
  }
  flush()
  return worktrees
}

function isInside(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset !== "" && !offset.startsWith("..") && !isAbsolute(offset)
}

async function attempt(
  kind: ReflectionOrphanReceipt["kind"],
  target: string,
  operation: () => Promise<boolean>,
): Promise<ReflectionOrphanReceipt> {
  try {
    return { kind, target, removed: await operation() }
  } catch (error) {
    return { kind, target, removed: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function directoryNames(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

async function git(exec: GitExec, cwd: string, argv: readonly string[]) {
  const result = await run(exec, cwd, argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result
}

function run(exec: GitExec, cwd: string, argv: readonly string[]) {
  return exec.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
}
