import type { GitMaintenanceOptions, GitMaintenanceResult } from "./repo-types"

/** The git calls `runMemoryRepoMaintenance` needs from a repo. */
export interface MaintenanceGit {
  (argv: readonly string[], timeoutMs?: number, signal?: AbortSignal): Promise<{ readonly stdout: string }>
}

/**
 * Packs loose objects, and folds the transfer packs a long-lived sync collects (#15139): each sync
 * round can receive a full-size pack, and nothing else ever consolidates them, so a repo reached
 * 29 GiB of 780 packs for a 112 MiB tree. Commits never run `gc --auto` (`gc.auto=0`, so a commit is
 * never held up by a repack), so without this a long-lived repo collects tens of thousands of loose
 * objects and every history walk slows down. git's `loose-objects` task writes them into a new pack
 * (it deletes loose copies only of objects that were already packed before it ran), then
 * `prune-packed` deletes the loose copies of everything now in a pack. The fold is a geometric
 * repack (#15420): it rolls the packs that break a factor-2 size progression, so equal-sized
 * duplicate transfer packs merge into one, and it carries every object of the packs it rolls
 * (unreachable ones included, none loosened), so it is safe while other processes keep committing.
 * Overlapping passes are kept apart by the caller's lock, not by git. (`incremental-repack` is left
 * out: it needs a multi-pack-index and fails on a repo that never had one.)
 */
const MAX_PACKS_BEFORE_REPACK = 16

/**
 * Reflogs and unreachable objects are dropped only past these grace periods (#15418), so the fresh
 * objects of a writer committing during the pass are never pruned. Pruning comes before the loose pass:
 * that pass packs every loose object, unreachable ones included, and `git prune` deletes loose objects only.
 */
export const REFLOG_EXPIRE = "30.days.ago"
export const REFLOG_EXPIRE_UNREACHABLE = "1.day.ago"
export const PRUNE_EXPIRE = "2.weeks.ago"

export async function runMemoryRepoMaintenance(
  git: MaintenanceGit,
  options: GitMaintenanceOptions,
): Promise<GitMaintenanceResult> {
  const { packs } = await countObjects(git)
  if (packs >= MAX_PACKS_BEFORE_REPACK) {
    await git(["repack", "-d", "-l", "--geometric=2", "--quiet"], options.timeoutMs, options.signal)
    options.signal?.throwIfAborted()
  }
  await git(
    ["reflog", "expire", `--expire=${REFLOG_EXPIRE}`, `--expire-unreachable=${REFLOG_EXPIRE_UNREACHABLE}`, "--all"],
    options.timeoutMs,
    options.signal,
  )
  options.signal?.throwIfAborted()
  await git(["prune", `--expire=${PRUNE_EXPIRE}`], options.timeoutMs, options.signal)
  options.signal?.throwIfAborted()
  const { looseObjects: looseObjectsBefore, packs: packsAfter } = await countObjects(git)
  if (looseObjectsBefore < options.minLooseObjects)
    return { status: "skipped", looseObjects: looseObjectsBefore, packsBefore: packs, packsAfter }
  await git(["maintenance", "run", "--task=loose-objects", "--quiet"], options.timeoutMs, options.signal)
  options.signal?.throwIfAborted()
  await git(["prune-packed", "--quiet"], options.timeoutMs, options.signal)
  return { status: "packed", looseObjectsBefore, looseObjectsAfter: await countLooseObjects(git) }
}

async function countObjects(git: MaintenanceGit): Promise<{ looseObjects: number; packs: number }> {
  const { stdout } = await git(["count-objects", "-v"])
  const loose = /^count: (\d+)$/m.exec(stdout)?.[1]
  const packs = /^packs: (\d+)$/m.exec(stdout)?.[1]
  return { looseObjects: loose === undefined ? 0 : Number(loose), packs: packs === undefined ? 0 : Number(packs) }
}

async function countLooseObjects(git: MaintenanceGit): Promise<number> {
  return (await countObjects(git)).looseObjects
}
