import { join } from "node:path"

import { existsSync, readFile, rm, writeFile } from "../fs/resilient"

// A memory write that failed with its change already staged while index.lock was held cannot be
// unstaged then (omo #10199). It records its paths and HEAD here, inside .git, and every write
// entry point of GitMemoryRepo settles the record first, once the index is free again.

const PENDING_ROLLBACK = "omo-pending-rollback.json"

export interface PendingRollback {
  readonly head: string
  readonly paths: readonly string[]
}

export interface PendingRollbackRepo {
  readonly dir: string
  head(): Promise<string | null>
  lsTree(revision?: string): Promise<string[]>
  status(paths?: readonly string[]): Promise<string>
  unstage(tracked: readonly string[], untracked: readonly string[]): Promise<void>
}

export class PendingRollbackEditsKeptError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(
      `An earlier memory write that failed behind a git lock was unstaged, but ${paths.join(", ")} ` +
      "changed after that failure, so the current file contents were kept as they are. " +
      "Commit or discard those edits, then retry the memory write.",
    )
    this.name = "PendingRollbackEditsKeptError"
  }
}

function markerPath(dir: string): string {
  return join(dir, ".git", PENDING_ROLLBACK)
}

export async function recordPendingRollback(dir: string, rollback: PendingRollback): Promise<void> {
  await writeFile(markerPath(dir), JSON.stringify(rollback), "utf8")
}

function parsePending(raw: string): PendingRollback | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return null
    const { head, paths } = value as { head?: unknown; paths?: unknown }
    if (typeof head !== "string" || !Array.isArray(paths) || !paths.every((path) => typeof path === "string")) return null
    return { head, paths }
  } catch {
    return null
  }
}

// Runs under the memory-write lock. Only the INDEX entries this write staged are undone; the
// working tree is never touched, because the failed write already put it back and anything there
// now is someone's later edit. A record made against another HEAD is dropped without acting: a
// commit happened since, and the normal dirty checks report whatever is left.
export async function settlePendingRollback(repo: PendingRollbackRepo): Promise<void> {
  const raw = await readFile(markerPath(repo.dir), "utf8").catch(() => undefined)
  if (raw === undefined || existsSync(join(repo.dir, ".git", "index.lock"))) return
  const pending = parsePending(raw)
  if (pending === null || (await repo.head()) !== pending.head || pending.paths.length === 0) {
    await rm(markerPath(repo.dir), { force: true })
    return
  }
  const atHead = new Set(await repo.lsTree("HEAD"))
  await repo.unstage(
    pending.paths.filter((path) => atHead.has(path)),
    pending.paths.filter((path) => !atHead.has(path)),
  )
  await rm(markerPath(repo.dir), { force: true })
  if ((await repo.status(pending.paths)).trim().length > 0) throw new PendingRollbackEditsKeptError(pending.paths)
}
