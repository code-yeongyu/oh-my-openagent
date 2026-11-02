import { join } from "node:path"
import { readFile, rm, writeFile } from "../fs/resilient"
import { NO_AUTO_MAINTENANCE } from "../git/no-auto-maintenance"
import type { ReflectionWorktree } from "./worktree"
import {
  isAncestor,
  optionalRevision,
  retryOnIndexLock,
  runGit,
  type IndexLockRetry,
} from "./worktree-integration-git"

// A reflection merge whose index could not be put back (index.lock held through every retry) leaves
// the validated tip staged in the parent (omo #11993). It records that tip here, inside .git, and
// the next integration finishes it by fast-forwarding, but only while nothing else touched the tree.

const STRANDED_MERGE = "omo-stranded-reflection-merge.json"

interface StrandedReflectionMerge {
  readonly head: string
  readonly tipSha: string
  readonly runId: string
}

function markerPath(worktree: ReflectionWorktree): string {
  return join(worktree.parent.dir, ".git", STRANDED_MERGE)
}

export async function recordStrandedMerge(worktree: ReflectionWorktree, stranded: StrandedReflectionMerge): Promise<void> {
  await writeFile(markerPath(worktree), JSON.stringify(stranded), "utf8")
}

function parseStranded(raw: string): StrandedReflectionMerge | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const { head, tipSha, runId } = value as Record<string, unknown>
    if (typeof head !== "string" || typeof tipSha !== "string" || typeof runId !== "string") return null
    return { head, tipSha, runId }
  } catch {
    return null
  }
}

async function holdsExactlyTip(worktree: ReflectionWorktree, tipSha: string): Promise<boolean> {
  const { exec } = worktree
  const dir = worktree.parent.dir
  const indexIsTip = await runGit(exec, dir, ["diff", "--cached", "--quiet", tipSha, "--"])
  if (indexIsTip.code !== 0) return false
  const treeIsIndex = await runGit(exec, dir, ["diff", "--quiet", "--"])
  if (treeIsIndex.code !== 0) return false
  const untracked = await runGit(exec, dir, ["ls-files", "--others", "--exclude-standard", "-z"])
  return untracked.code === 0 && untracked.stdout === ""
}

/** Runs under the memory-write lock, before the parent's dirty check. */
export async function healStrandedMerge(worktree: ReflectionWorktree, retry: IndexLockRetry): Promise<void> {
  const path = markerPath(worktree)
  const raw = await readFile(path, "utf8").catch(() => undefined)
  if (raw === undefined) return
  const stranded = parseStranded(raw)
  const { exec } = worktree
  const dir = worktree.parent.dir
  if (stranded === null || await optionalRevision(exec, dir, "HEAD") !== stranded.head) {
    await rm(path, { force: true })
    return
  }
  const mergeHead = await optionalRevision(exec, dir, "MERGE_HEAD")
  if (mergeHead !== null && mergeHead !== stranded.tipSha) return
  if (mergeHead === null && (await worktree.parent.status()).trim() === "") {
    await rm(path, { force: true })
    return
  }
  if (!await isAncestor(exec, dir, stranded.head, stranded.tipSha)) return
  if (!await holdsExactlyTip(worktree, stranded.tipSha)) return
  if (mergeHead !== null && (await runGit(exec, dir, ["merge", "--quit"])).code !== 0) return
  const forwarded = await retryOnIndexLock(retry, () =>
    runGit(exec, dir, [...NO_AUTO_MAINTENANCE, "merge", "--ff-only", stranded.tipSha]))
  if (forwarded.code === 0) await rm(path, { force: true })
}
