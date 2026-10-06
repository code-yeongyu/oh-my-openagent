import type { GitMaintenanceOptions, GitMaintenanceResult } from "./repo-types"

/** The git calls `runMemoryRepoMaintenance` needs from a repo. */
export interface MaintenanceGit {
  (argv: readonly string[], timeoutMs?: number, signal?: AbortSignal): Promise<{ readonly stdout: string }>
}

/**
 * Packs loose objects. Commits never run `gc --auto` (`gc.auto=0`, so a commit is never held up by a
 * repack), so without this a long-lived repo collects tens of thousands of loose objects and every
 * history walk slows down. git's `loose-objects` task writes them into a new pack (it deletes loose
 * copies only of objects that were already packed before it ran), then `prune-packed` deletes the
 * loose copies of everything now in a pack. Both only ever remove an object that a pack also holds,
 * and neither prunes unreachable objects, so they are safe while other processes keep committing.
 * Overlapping passes are kept apart by the caller's lock, not by git. (`incremental-repack` is left
 * out: it needs a multi-pack-index and fails on a repo that never had one.)
 */
export async function runMemoryRepoMaintenance(
  git: MaintenanceGit,
  options: GitMaintenanceOptions,
): Promise<GitMaintenanceResult> {
  const looseObjectsBefore = await countLooseObjects(git)
  if (looseObjectsBefore < options.minLooseObjects) return { status: "skipped", looseObjects: looseObjectsBefore }
  await git(["maintenance", "run", "--task=loose-objects", "--quiet"], options.timeoutMs, options.signal)
  options.signal?.throwIfAborted()
  await git(["prune-packed", "--quiet"], options.timeoutMs, options.signal)
  return { status: "packed", looseObjectsBefore, looseObjectsAfter: await countLooseObjects(git) }
}

async function countLooseObjects(git: MaintenanceGit): Promise<number> {
  const { stdout } = await git(["count-objects", "-v"])
  const count = /^count: (\d+)$/m.exec(stdout)?.[1]
  return count === undefined ? 0 : Number(count)
}
