import { hostname } from "node:os"
import { join, resolve } from "node:path"

import { lstat, readFile, unlink, type BigIntStats } from "../fs/resilient"
import { LockContentionError, acquireLock, createLockRecord, getPidLiveness, parseLockRecord, releaseLock } from "../locks"
import { PRODUCTION_LOCK_SCANS, type GitLockScans } from "./lock-scans"
import { presentLockFiles, writerLockPathForRepo } from "./repo-lock-sweep"

// The manual way out of a kept stranded git lock (omo #10199). It re-checks ONE lock with the
// sweep's own evidence and never decides on its own: a visible live holder, repository user or
// memory writer refuses; anything else needs the user's confirmation, and an unknown answer is
// reported as unknown rather than read as "nobody".

export type UnlockScans = GitLockScans

const PRODUCTION_SCANS: UnlockScans = PRODUCTION_LOCK_SCANS

export interface UnlockFindings {
  readonly kind: "found"
  readonly lockPath: string
  readonly identity: string
  readonly holders: readonly number[] | null
  readonly repoUsers: readonly number[] | null
  readonly writer: WriterState
  readonly writerLockPath: string | null
  readonly verdict: "refuse" | "confirm"
}

// What the identity's memory-write lock says about a writer: none recorded (or proven dead), one
// visibly alive on this host (this process included), or unknown (unreadable record, another host,
// or liveness that cannot be read). Unknown is never shown or treated as none.
export type WriterState = { readonly kind: "none" } | { readonly kind: "alive"; readonly pid: number } | { readonly kind: "unknown" }

export type UnlockInspection = { readonly kind: "not-a-git-lock" } | { readonly kind: "missing" } | UnlockFindings

export type UnlockOutcome =
  | { readonly kind: "removed"; readonly lockPath: string }
  | { readonly kind: "refused"; readonly inspection: UnlockFindings }
  | { readonly kind: "changed"; readonly lockPath: string }
  | { readonly kind: "missing" | "not-a-git-lock" }
  | { readonly kind: "unlink-failed"; readonly lockPath: string; readonly message: string }

async function memoryWriterState(repoDir: string, ownNonce?: string): Promise<WriterState> {
  const writerLockPath = writerLockPathForRepo(repoDir)
  if (writerLockPath === null) return { kind: "none" }
  let raw: string
  try {
    raw = await readFile(writerLockPath, "utf8")
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT" ? { kind: "none" } : { kind: "unknown" }
  }
  const record = parseLockRecord(raw)
  if (record === null || record.hostname !== hostname()) return { kind: "unknown" }
  if (ownNonce !== undefined && record.nonce === ownNonce) return { kind: "none" }
  const liveness = getPidLiveness(record.pid)
  if (liveness === "alive") return { kind: "alive", pid: record.pid }
  return liveness === "dead" ? { kind: "none" } : { kind: "unknown" }
}

// On ext4 a removed file's inode is reused at once and the coarse timestamp clock can repeat, so
// inode plus mtime cannot tell a re-taken lock from the inspected one; size and the nanosecond
// change and birth times narrow it to a replacement of the same size within one clock tick.
function fileIdentity(status: BigIntStats): string {
  return [status.dev, status.ino, status.size, status.mtimeNs, status.ctimeNs, status.birthtimeNs].join(":")
}

export async function inspectStrandedGitLock(repoDir: string, lockPath: string, scans: UnlockScans = PRODUCTION_SCANS, ownWriterNonce?: string): Promise<UnlockInspection> {
  const target = resolve(lockPath)
  const present = await presentLockFiles(join(resolve(repoDir), ".git"))
  if (!present.has(target)) {
    const status = await lstat(target).catch(() => undefined)
    return status === undefined && target.startsWith(join(resolve(repoDir), ".git")) && target.endsWith(".lock")
      ? { kind: "missing" }
      : { kind: "not-a-git-lock" }
  }
  const status = await lstat(target, { bigint: true }).catch(() => undefined)
  if (status === undefined) return { kind: "missing" }
  const [holders, repoUsers, writer] = await Promise.all([
    scans.findHolders(target),
    scans.findRepoUsers(repoDir),
    memoryWriterState(repoDir, ownWriterNonce),
  ])
  // An unknown writer refuses up front: the unlock must hold the writer lock, which it cannot take
  // over an unreadable or foreign record, so offering a confirm would only end in a refusal.
  const visiblyLive = (holders?.length ?? 0) > 0 || (repoUsers?.length ?? 0) > 0 || writer.kind !== "none"
  return {
    kind: "found",
    lockPath: target,
    identity: fileIdentity(status),
    holders,
    repoUsers,
    writer,
    writerLockPath: writerLockPathForRepo(repoDir),
    verdict: visiblyLive ? "refuse" : "confirm",
  }
}

// Invariant: the unlink follows a fresh inspection that still allows it and still sees the same
// file (inode and mtime); a lock re-taken by a new git process after the user confirmed is a
// different file and is never deleted.
// The memory-write lock is held (without waiting) across the re-inspection and the unlink, so no
// memory writer - one in this very process included - can start a git operation in between; a
// writer already holding it means a write is in progress, and the unlock refuses.
export async function unlockStrandedGitLock(repoDir: string, confirmed: UnlockFindings, scans: UnlockScans = PRODUCTION_SCANS): Promise<UnlockOutcome> {
  const writerLockPath = writerLockPathForRepo(repoDir)
  if (writerLockPath === null) return removeIfUnchanged(repoDir, confirmed, scans)
  const record = await createLockRecord("memory-write")
  try {
    await acquireLock(writerLockPath, record)
  } catch (error) {
    if (!(error instanceof LockContentionError)) throw error
    const pid = error.owner?.pid
    return { kind: "refused", inspection: { ...confirmed, writer: pid === undefined ? { kind: "unknown" } : { kind: "alive", pid }, verdict: "refuse" } }
  }
  try {
    return await removeIfUnchanged(repoDir, confirmed, scans, record.nonce)
  } finally {
    await releaseLock(writerLockPath, record)
  }
}

async function removeIfUnchanged(repoDir: string, confirmed: UnlockFindings, scans: UnlockScans, ownWriterNonce?: string): Promise<UnlockOutcome> {
  const fresh = await inspectStrandedGitLock(repoDir, confirmed.lockPath, scans, ownWriterNonce)
  if (fresh.kind !== "found") return { kind: fresh.kind }
  if (fresh.identity !== confirmed.identity) return { kind: "changed", lockPath: fresh.lockPath }
  if (fresh.verdict === "refuse") return { kind: "refused", inspection: fresh }
  try {
    await unlink(fresh.lockPath)
    return { kind: "removed", lockPath: fresh.lockPath }
  } catch (error) {
    return { kind: "unlink-failed", lockPath: fresh.lockPath, message: error instanceof Error ? error.message : String(error) }
  }
}
