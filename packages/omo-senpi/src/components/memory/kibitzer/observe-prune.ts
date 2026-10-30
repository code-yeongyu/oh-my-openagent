// Retention: a sidecar directory idle for seven days is removed - never while a session owns it.
// Ownership is an ordinary memory-core lock (`locks/recall-sidecar.<encoded-session>.lock`) held
// from sidecar creation to session shutdown, so a sweep from another process sees a live owner
// (contention) and skips, while a crashed owner is recovered only on pid/start-identity proof, as
// every other lock domain does. This process's own live sessions are skipped before any lock is
// touched. A directory is claimed by rename under its owner lock and deleted afterwards, and a
// tombstone left by a crash is cleared by the next sweep.

import { randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"

import { LockContentionError, acquireLock, createLockRecord, releaseLock, type LockRecord } from "@oh-my-opencode/memory-core"
import { lstat, readdir, rename, rm } from "@oh-my-opencode/memory-core/fs"

import { ENCODED_SESSION_PATTERN, OWNER_LOCK_PURPOSE, PRUNE_TOMBSTONE_PREFIX, kibitzerSidecarsRoot, ownerLockPathFor } from "./observe-paths"

/** A sidecar directory idle this long is removed by the next sweep, unless a session still owns it. */
export const KIBITZER_SIDECAR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export interface PruneKibitzerSidecarsOptions {
  readonly recallDir: string
  readonly locksDir: string
  readonly now?: () => number
  readonly maxAgeMs?: number
  /** Encoded directory names of this process's live sessions: skipped before any lock is touched. */
  readonly owned?: ReadonlySet<string>
  readonly warn?: (message: string, details: Record<string, unknown>) => void
}

export interface PruneKibitzerSidecarsResult {
  /** Encoded directory names removed. */
  readonly pruned: readonly string[]
  /** Encoded directory names inspected and left in place. */
  readonly kept: readonly string[]
}

/**
 * Removes every sidecar directory idle for `maxAgeMs`, except one owned by a live session: this
 * process's own sessions by name, any process's by its owner lock (contention means live; a dead
 * owner is recovered only on proof). The idle check is repeated under the lock so a session that
 * came alive during the scan keeps its directory. Anything that is not a directory is ignored.
 */
export async function pruneKibitzerSidecars(options: PruneKibitzerSidecarsOptions): Promise<PruneKibitzerSidecarsResult> {
  const now = options.now ?? Date.now
  const maxAgeMs = options.maxAgeMs ?? KIBITZER_SIDECAR_RETENTION_MS
  const owned = options.owned ?? new Set<string>()
  const root = kibitzerSidecarsRoot(options.recallDir)
  const names = await readdir(root).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") options.warn?.("omo-senpi kibitzer sidecar sweep listing failed", { path: root, error: describe(error) })
    return [] as string[]
  })
  const pruned: string[] = []
  const kept: string[] = []
  for (const name of names) {
    const path = join(root, name)
    if (name.startsWith(PRUNE_TOMBSTONE_PREFIX)) {
      await remove(path, options.warn)
      continue
    }
    if (owned.has(name) || !ENCODED_SESSION_PATTERN.test(name)) {
      if (owned.has(name)) kept.push(name)
      continue
    }
    const stats = await lstat(path).catch(() => undefined)
    if (stats === undefined || !stats.isDirectory()) continue
    if (!(await idleFor(path, now(), maxAgeMs))) {
      kept.push(name)
      continue
    }
    if (await claimAndRemove(path, ownerLockPathFor(options.locksDir, name), now(), maxAgeMs, options.warn)) pruned.push(name)
    else kept.push(name)
  }
  return { pruned, kept }
}

/** True when neither the directory nor anything directly inside it changed within `maxAgeMs`. */
async function idleFor(dir: string, at: number, maxAgeMs: number): Promise<boolean> {
  const newest = await newestMtime(dir)
  return newest !== undefined && at - newest >= maxAgeMs
}

async function newestMtime(dir: string): Promise<number | undefined> {
  const own = await lstat(dir).then((stats) => stats.mtimeMs, () => undefined)
  if (own === undefined) return undefined
  let newest = own
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const stamp = await lstat(join(dir, name)).then((stats) => stats.mtimeMs, () => undefined)
    if (stamp !== undefined && stamp > newest) newest = stamp
  }
  return newest
}

/** Takes the directory's owner lock without waiting; a live owner keeps it, a dead one is recovered on proof. */
async function claimAndRemove(
  dir: string,
  lockPath: string,
  at: number,
  maxAgeMs: number,
  warn: PruneKibitzerSidecarsOptions["warn"],
): Promise<boolean> {
  let record: LockRecord
  try {
    record = await createLockRecord(OWNER_LOCK_PURPOSE)
    await acquireLock(lockPath, record, { waitTimeoutMs: 0 })
  } catch (error) {
    if (!(error instanceof LockContentionError)) warn?.("omo-senpi kibitzer sidecar sweep lock failed", { lockPath, error: describe(error) })
    return false
  }
  try {
    // A session that came alive between the scan and the lock has written since: leave it alone.
    if (!(await idleFor(dir, at, maxAgeMs))) return false
    const tombstone = join(dirname(dir), `${PRUNE_TOMBSTONE_PREFIX}${basename(dir)}-${randomUUID()}`)
    try {
      await rename(dir, tombstone)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false
      warn?.("omo-senpi kibitzer sidecar sweep claim failed", { path: dir, error: describe(error) })
      return false
    }
    return remove(tombstone, warn)
  } finally {
    await releaseLock(lockPath, record).catch((error: unknown) => {
      warn?.("omo-senpi kibitzer sidecar sweep lock release failed", { lockPath, error: describe(error) })
    })
  }
}

async function remove(path: string, warn: PruneKibitzerSidecarsOptions["warn"]): Promise<boolean> {
  try {
    await rm(path, { recursive: true, force: true })
    return true
  } catch (error) {
    warn?.("omo-senpi kibitzer sidecar sweep removal failed", { path, error: describe(error) })
    return false
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
