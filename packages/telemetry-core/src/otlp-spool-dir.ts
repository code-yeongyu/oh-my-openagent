import { linkSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs"
import { rename } from "node:fs/promises"
import { join } from "node:path"

import { countSpoolRecords, type Signal } from "./otlp-spool-file"
import { holdsLock, holdsLockSync, isAbandonedLock, throwAfterRollBack, tryLock, tryLockSync, unlock } from "./otlp-spool-lock"

/** Why records were lost before acceptance; `write_failed` = the record never reached the spool. */
export type DropReason = "evicted" | "expired" | "rejected" | "corrupt" | "write_failed"

export const SPOOL_CAP_BYTES = 5 * 1024 * 1024
export const SPOOL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
export const CLAIM_LEASE_MS = 5 * 60 * 1000
export const DEAD_OWNER_IDLE_MS = 300_000

export type SpoolContext = {
  readonly dir: string
  readonly bootId: string
  readonly pid: number
  readonly nowMs: () => number
  readonly isPidAlive: (pid: number) => boolean
  readonly capBytes: number
  readonly maxAgeMs: number
  readonly onDrop: (reason: DropReason, records: number) => void
  /** A move succeeded but its lock could not be deleted (the sweep removes it after the claim lease). */
  readonly onLockLeft?: (error: unknown) => void
}

export {
  QUARANTINE_DIR,
  activeName,
  batchName,
  isSpoolFileName,
  parseSpoolName,
  type SpoolEntry,
} from "./otlp-spool-names"
import { activeName, batchName, parseSpoolName, QUARANTINE_DIR, sendingName, type SpoolEntry } from "./otlp-spool-names"

const HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"))

export const BATCH_ID_COUNTER_LIMIT = 2 ** 26

export type BatchIdCounter = { readonly ms: number; readonly counter: number; readonly overflowed: boolean }

/**
 * Documented limit: order holds across ONE counter overflow while the clock stays one millisecond
 * behind the advanced timestamp. A second overflow within that clock millisecond (2^25 or more ids)
 * reseeds at the clock's millisecond, below the advanced one, so order can break there.
 */
export function nextBatchIdCounter(last: BatchIdCounter, ms: number, random: () => number): BatchIdCounter {
  if (ms === last.ms || (ms === last.ms - 1 && last.overflowed)) {
    const counter = last.counter + 1
    return counter >= BATCH_ID_COUNTER_LIMIT
      ? { ms: last.ms + 1, counter: 0, overflowed: true }
      : { ms: last.ms, counter, overflowed: last.overflowed }
  }
  return { ms, counter: Math.floor(random() * (BATCH_ID_COUNTER_LIMIT / 2)), overflowed: false }
}

let lastId: BatchIdCounter = { ms: -1, counter: 0, overflowed: false }

/**
 * UUIDv7 (RFC 9562) with a fixed-length dedicated counter (section 6.2, method 1): 48-bit unix
 * milliseconds, version 7, then a 26-bit counter in rand_a (12 bits) and the top 14 bits of rand_b
 * after the variant, then random bits. Repeated calls for the same millisecond increment the
 * counter, so ids sort in creation order and the send and eviction order equals the seal order. Any
 * other millisecond reseeds the counter with a random value whose top bit is 0, leaving at least
 * 2^25 increments; a recovered file's id therefore keeps its own (older) creation time. An
 * exhausted counter moves the timestamp one millisecond forward, as the RFC allows. Never sent.
 */
export function createBatchId(unixMs: number): string {
  lastId = nextBatchIdCounter(lastId, Math.max(0, Math.floor(unixMs)), Math.random)
  let timestamp = lastId.ms
  const counter = lastId.counter
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }
  // counter bits 25..14 -> rand_a (12 bits); bits 13..8 -> byte 8 after the variant; bits 7..0 -> byte 9
  bytes[6] = 0x70 | ((counter >>> 22) & 0x0f)
  bytes[7] = (counter >>> 14) & 0xff
  bytes[8] = 0x80 | ((counter >>> 8) & 0x3f)
  bytes[9] = counter & 0xff
  const hex = Array.from(bytes, (byte) => HEX[byte] ?? "00").join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Fixed-width lowercase hex ids sort by creation time, then by the in-millisecond counter. */
export function compareBatchIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function batchCreatedMs(batchId: string): number {
  return Number.parseInt(batchId.slice(0, 8) + batchId.slice(9, 13), 16)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

/** A rename of a file only this process moves, or to a name every competitor would choose. */
function tryRename(dir: string, from: string, to: string): boolean {
  try {
    renameSync(join(dir, from), join(dir, to))
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

/** A competing move to a name of this process's own: the file's lock picks the one mover (see otlp-spool-lock). */
function lockedRename(ctx: SpoolContext, from: string, to: string): boolean {
  const token = tryLockSync(ctx.dir, from, ctx)
  if (token === null) return false
  try {
    if (!holdsLockSync(ctx.dir, from, token)) return false
    try {
      return tryRename(ctx.dir, from, to)
    } catch (error) {
      throwAfterRollBack(ctx.dir, from, to, error)
    }
  } finally {
    unlock(ctx.dir, from, token, ctx.onLockLeft)
  }
}

export function listSpool(dir: string): SpoolEntry[] {
  try {
    return readdirSync(dir).map(parseSpoolName)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/**
 * The claim rename runs off the event loop: a rename can stall for a long time on a contended
 * filesystem, and a stalled synchronous call would hold every timer, the shutdown deadline included.
 */
export async function claimBatch(
  ctx: SpoolContext,
  entry: { readonly signal: Signal; readonly batchId: string },
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<string | null> {
  const source = batchName(entry.signal, entry.batchId)
  const token = await tryLock(ctx.dir, source, ctx)
  if (token === null) return null
  try {
    if (!(await holdsLock(ctx.dir, source, token))) return null
    const claimed = sendingName(entry.signal, entry.batchId, ctx.bootId, ctx.nowMs() + CLAIM_LEASE_MS)
    try {
      await move(join(ctx.dir, source), join(ctx.dir, claimed))
    } catch (error) {
      if (isMissing(error)) return null
      throwAfterRollBack(ctx.dir, source, claimed, error)
    }
    return claimed
  } finally {
    unlock(ctx.dir, source, token, ctx.onLockLeft)
  }
}

export function renewClaim(ctx: SpoolContext, claimed: string): string | null {
  const entry = parseSpoolName(claimed)
  if (entry.kind !== "sending") return null
  const renewed = sendingName(entry.signal, entry.batchId, ctx.bootId, ctx.nowMs() + CLAIM_LEASE_MS)
  return lockedRename(ctx, claimed, renewed) ? renewed : null
}

/** Only the claim's owner releases it, so the owner-only link move is enough (no competitor). */
export function releaseClaim(ctx: SpoolContext, claimed: string): boolean {
  const entry = parseSpoolName(claimed)
  return entry.kind === "sending" && tryLinkMove(ctx.dir, claimed, batchName(entry.signal, entry.batchId))
}

export function deleteFile(dir: string, name: string): boolean {
  try {
    unlinkSync(join(dir, name))
    return true
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
}

const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"])

function lacksHardLinks(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && NO_HARD_LINKS.has(error.code)
}

/**
 * Moves a file that only this process may move (its own active file or its own claim) as a hard
 * link plus an unlink of the old name: a reader still sees the new name appear with the complete
 * content, and the pair costs well under a millisecond where a rename can take 50-130 ms (measured
 * in a Linux container VM). A crash between the two leaves the old name as a second link, which the
 * sweep deletes instead of recovering it again. Filesystems without hard links fall back to rename.
 * Competing movers (claims, renewals, lease reclaims, dead-owner seals) rename under the file's lock.
 */
function tryLinkMove(dir: string, from: string, to: string): boolean {
  try {
    linkSync(join(dir, from), join(dir, to))
  } catch (error) {
    if (isMissing(error)) return false
    if (!lacksHardLinks(error)) throw error
    return tryRename(dir, from, to)
  }
  deleteFile(dir, from)
  return true
}

/** False when the active file is gone: an opt-out purge by another process deleted it, records included. */
export function publishBatch(dir: string, activeName: string, sealedName: string): boolean {
  return tryLinkMove(dir, activeName, sealedName)
}

export function dropFile(ctx: SpoolContext, name: string, reason: DropReason): void {
  const records = countSpoolRecords(join(ctx.dir, name))
  if (deleteFile(ctx.dir, name)) ctx.onDrop(reason, records)
}


/**
 * Corrupt files are kept for inspection but are bounded like everything else: they count toward the
 * spool cap (and are evicted first, see `enforceSpoolCap`) and expire by the same age limit, measured
 * from their last write. Their records were already counted as `corrupt` when they were moved here.
 */
export function quarantineFile(ctx: SpoolContext, name: string): void {
  const records = countSpoolRecords(join(ctx.dir, name))
  mkdirSync(join(ctx.dir, QUARANTINE_DIR), { recursive: true, mode: 0o700 })
  if (tryRename(ctx.dir, name, join(QUARANTINE_DIR, name))) ctx.onDrop("corrupt", records)
}

export type QuarantinedFile = { readonly path: string; readonly size: number; readonly mtimeMs: number }

/** Quarantined files, oldest first. */
export function listQuarantine(ctx: SpoolContext): QuarantinedFile[] {
  const dir = join(ctx.dir, QUARANTINE_DIR)
  return listSpool(dir).flatMap((entry) => {
    const stat = fileStat(dir, entry.name)
    return stat === null ? [] : [{ path: join(QUARANTINE_DIR, entry.name), size: stat.size, mtimeMs: stat.mtimeMs }]
  }).sort((a, b) => a.mtimeMs - b.mtimeMs)
}

type FileStat = { readonly size: number; readonly mtimeMs: number; readonly birthMs: number; readonly links: number }

export function fileStat(dir: string, name: string): FileStat | null {
  try {
    const stat = statSync(join(dir, name))
    const birthMs = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
    return { size: stat.size, mtimeMs: stat.mtimeMs, birthMs, links: stat.nlink }
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

function isDeadOwner(ctx: SpoolContext, entry: { readonly pid: number; readonly bootId: string }): boolean {
  if (entry.pid === ctx.pid) return entry.bootId !== ctx.bootId
  return !ctx.isPidAlive(entry.pid)
}

/**
 * Recovers what dead or stalled processes left (D-H claim rules): expired leases go back to sealed
 * batches, a dead owner's idle active file is sealed (its batch id keeps the file's creation time,
 * so the 14-day limit is never extended), an active file or expired claim that is still a second
 * link of its already moved file (a crash inside `tryLinkMove`) is deleted, and sealed batches and
 * quarantined files past the age limit are dropped.
 */
export function sweepSpool(ctx: SpoolContext): void {
  const now = ctx.nowMs()
  for (const entry of listSpool(ctx.dir)) {
    if (entry.kind === "sending" && entry.leaseExpiresMs <= now) {
      if ((fileStat(ctx.dir, entry.name)?.links ?? 1) > 1) deleteFile(ctx.dir, entry.name)
      else lockedRename(ctx, entry.name, batchName(entry.signal, entry.batchId))
    } else if (entry.kind === "active" && isDeadOwner(ctx, entry)) {
      const stat = fileStat(ctx.dir, entry.name)
      if (stat !== null && stat.links > 1) {
        deleteFile(ctx.dir, entry.name)
      } else if (stat !== null && now - stat.mtimeMs >= DEAD_OWNER_IDLE_MS) {
        lockedRename(ctx, entry.name, batchName(entry.signal, createBatchId(stat.birthMs)))
      }
    } else if (entry.kind === "active" && entry.pid !== ctx.pid) {
      // A live pid may be a later process that reused it: an active file nobody appended to for the age
      // limit is abandoned whoever holds the pid now.
      const stat = fileStat(ctx.dir, entry.name)
      if (stat !== null && now - stat.mtimeMs > ctx.maxAgeMs) dropFile(ctx, entry.name, "expired")
    } else if (entry.kind === "lock") {
      const stat = fileStat(ctx.dir, entry.name)
      const limits = { leaseMs: CLAIM_LEASE_MS, maxAgeMs: ctx.maxAgeMs, isPidAlive: ctx.isPidAlive, self: ctx }
      if (stat !== null && isAbandonedLock(ctx.dir, entry.name, now - stat.mtimeMs, limits)) deleteFile(ctx.dir, entry.name)
    }
  }
  for (const entry of listSpool(ctx.dir)) {
    if (entry.kind === "batch" && now - batchCreatedMs(entry.batchId) > ctx.maxAgeMs) {
      dropFile(ctx, entry.name, "expired")
    }
  }
  for (const file of listQuarantine(ctx)) {
    if (now - file.mtimeMs > ctx.maxAgeMs) deleteFile(ctx.dir, file.path)
  }
}

export function oldestSealedBatches(dir: string): Extract<SpoolEntry, { readonly kind: "batch" }>[] {
  return listSpool(dir)
    .flatMap((entry) => (entry.kind === "batch" ? [entry] : []))
    .sort((a, b) => compareBatchIds(a.batchId, b.batchId))
}
