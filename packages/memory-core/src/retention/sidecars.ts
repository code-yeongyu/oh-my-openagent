// Kibitzer sidecar retention (moved from omo-senpi kibitzer/observe-prune.ts, design 2.4): a sidecar
// directory idle for the retention window is removed - never while a session owns it. Ownership is
// an ordinary memory-core lock (`locks/recall-sidecar.<encoded-session>.lock`) held from sidecar
// creation to session shutdown, so a sweep from another process sees a live owner (contention) and
// skips, while a crashed owner is recovered only on pid/start-identity proof, as every other lock
// domain does. This process's own live sessions are skipped before any lock is touched. A directory
// is claimed by rename under its owner lock and deleted afterwards, and a tombstone left by a crash
// is cleared by the next sweep.

import { randomUUID } from "node:crypto"
import { basename, dirname, join } from "node:path"

import { lstat, readdir, rename } from "../fs/resilient"
import { removeTree } from "../fs/remove-tree"
import { LockContentionError, acquireLock, createLockRecord, releaseLock, type LockRecord } from "../locks"
import type { RetentionKeepReason } from "./policy"

export const KIBITZER_SIDECAR_OWNER_LOCK_PURPOSE = "recall-sidecar"
export const KIBITZER_SIDECAR_TOMBSTONE_PREFIX = ".prune-"
export const KIBITZER_ENCODED_SESSION_PATTERN = /^[A-Za-z0-9_-]+$/
const SIDECARS_DIRNAME = "sidecars"
const OWNER_LOCK_PREFIX = "recall-sidecar."
const OWNER_LOCK_SUFFIX = ".lock"

/** A sidecar directory idle this long is removed by the next sweep, unless a session still owns it. */
export const KIBITZER_SIDECAR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function kibitzerSidecarsRoot(recallDir: string): string {
  return join(recallDir, SIDECARS_DIRNAME)
}

export function kibitzerSidecarOwnerLockPathFor(locksDir: string, encodedSession: string): string {
  return join(locksDir, `${OWNER_LOCK_PREFIX}${encodedSession}${OWNER_LOCK_SUFFIX}`)
}

export interface PruneKibitzerSidecarsOptions {
  readonly recallDir: string
  readonly locksDir: string
  readonly now?: () => number
  readonly maxAgeMs?: number
  /** Encoded directory names of this process's live sessions: skipped before any lock is touched. */
  readonly owned?: ReadonlySet<string>
  readonly warn?: (message: string, details: Record<string, unknown>) => void
  readonly beforeClaimRename?: (from: string, to: string) => Promise<void>
  readonly beforeTombstoneDelete?: (tombstone: string) => Promise<void>
  /** Resume and budget hooks of the retention pass; absent for the session-shutdown sweep. */
  readonly skip?: (name: string) => boolean
  readonly admit?: () => boolean
  readonly done?: (name: string) => void
}

export interface PruneKibitzerSidecarsResult {
  /** Encoded directory names removed. */
  readonly pruned: readonly string[]
  /** Encoded directory names inspected and left in place. */
  readonly kept: readonly string[]
  readonly keptReasons: Readonly<Record<string, RetentionKeepReason>>
}

/**
 * Removes every sidecar directory idle for `maxAgeMs`, except one owned by a live session: this
 * process's own sessions by name, any process's by its owner lock (contention means live; a dead
 * owner is recovered only on proof). The idle check is repeated under the lock so a session that
 * came alive during the scan keeps its directory. Anything that is not a directory is ignored.
 */
export async function pruneKibitzerSidecars(
  options: PruneKibitzerSidecarsOptions,
): Promise<PruneKibitzerSidecarsResult> {
  const now = options.now ?? Date.now
  const maxAgeMs = options.maxAgeMs ?? KIBITZER_SIDECAR_RETENTION_MS
  const owned = options.owned ?? new Set<string>()
  const root = kibitzerSidecarsRoot(options.recallDir)
  const names = await readdir(root).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT")
      options.warn?.("kibitzer sidecar sweep listing failed", { path: root, error: describe(error) })
    return [] as string[]
  })
  const pruned: string[] = []
  const keptReasons: Record<string, RetentionKeepReason> = {}
  for (const name of [...names].sort()) {
    const path = join(root, name)
    if (!name.startsWith(KIBITZER_SIDECAR_TOMBSTONE_PREFIX)) {
      if (options.skip?.(name) === true) continue
      if (options.admit?.() === false) break
    }
    const outcome = await visitSidecar(options, name, path, now, maxAgeMs, owned)
    if (outcome === "removed") pruned.push(name)
    else if (outcome !== undefined) keptReasons[name] = outcome
    if (!name.startsWith(KIBITZER_SIDECAR_TOMBSTONE_PREFIX)) options.done?.(name)
  }
  return { pruned, kept: Object.keys(keptReasons), keptReasons }
}

async function visitSidecar(
  options: PruneKibitzerSidecarsOptions,
  name: string,
  path: string,
  now: () => number,
  maxAgeMs: number,
  owned: ReadonlySet<string>,
): Promise<"removed" | RetentionKeepReason | undefined> {
  if (name.startsWith(KIBITZER_SIDECAR_TOMBSTONE_PREFIX)) {
    await remove(path, options.warn)
    return undefined
  }
  if (owned.has(name)) return "owned"
  if (!KIBITZER_ENCODED_SESSION_PATTERN.test(name)) return undefined
  const stats = await lstat(path).catch(() => undefined)
  if (stats === undefined || !stats.isDirectory()) return undefined
  if (!(await idleFor(path, now(), maxAgeMs))) return "recent"
  return claimAndRemove(path, kibitzerSidecarOwnerLockPathFor(options.locksDir, name), now(), maxAgeMs, options)
}

/** True when neither the directory nor anything directly inside it changed within `maxAgeMs`. */
async function idleFor(dir: string, at: number, maxAgeMs: number): Promise<boolean> {
  const newest = await newestMtime(dir)
  return newest !== undefined && at - newest >= maxAgeMs
}

async function newestMtime(dir: string): Promise<number | undefined> {
  const own = await lstat(dir).then(
    (stats) => stats.mtimeMs,
    () => undefined,
  )
  if (own === undefined) return undefined
  let newest = own
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const stamp = await lstat(join(dir, name)).then(
      (stats) => stats.mtimeMs,
      () => undefined,
    )
    if (stamp !== undefined && stamp > newest) newest = stamp
  }
  return newest
}

/**
 * Takes the directory's owner lock without waiting (a live owner keeps it, a dead one is recovered on
 * proof), renames the directory to a tombstone under it, and deletes the tombstone only after the lock
 * is released, so a slow delete never holds a session's owner lock.
 */
async function claimAndRemove(
  dir: string,
  lockPath: string,
  at: number,
  maxAgeMs: number,
  options: PruneKibitzerSidecarsOptions,
): Promise<"removed" | RetentionKeepReason> {
  const warn = options.warn
  let record: LockRecord
  try {
    record = await createLockRecord(KIBITZER_SIDECAR_OWNER_LOCK_PURPOSE)
    await acquireLock(lockPath, record, { waitTimeoutMs: 0 })
  } catch (error) {
    if (!(error instanceof LockContentionError))
      warn?.("kibitzer sidecar sweep lock failed", { lockPath, error: describe(error) })
    return "locked"
  }
  let tombstone: string
  try {
    // A session that came alive between the scan and the lock has written since: leave it alone.
    if (!(await idleFor(dir, at, maxAgeMs))) return "recent"
    tombstone = join(dirname(dir), `${KIBITZER_SIDECAR_TOMBSTONE_PREFIX}${basename(dir)}-${randomUUID()}`)
    try {
      await options.beforeClaimRename?.(dir, tombstone)
      await rename(dir, tombstone)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "changed-during-removal"
      warn?.("kibitzer sidecar sweep claim failed", { path: dir, error: describe(error) })
      return "claim-failed"
    }
  } finally {
    await releaseLock(lockPath, record).catch((error: unknown) => {
      warn?.("kibitzer sidecar sweep lock release failed", { lockPath, error: describe(error) })
    })
  }
  // The live name is gone; a tombstone whose delete fails is cleared by the next sweep.
  await options.beforeTombstoneDelete?.(tombstone)
  await remove(tombstone, warn)
  return "removed"
}

async function remove(path: string, warn: PruneKibitzerSidecarsOptions["warn"]): Promise<boolean> {
  try {
    await removeTree(path)
    return true
  } catch (error) {
    warn?.("kibitzer sidecar sweep removal failed", { path, error: describe(error) })
    return false
  }
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The cap (cap.ts) evicts one sidecar through the same owner-lock claim, with its 1 h floor as the idle window. */
export { claimAndRemove as claimKibitzerSidecar }
