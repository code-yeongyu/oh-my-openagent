import { randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"

/** Distinguishes this process from a predecessor that reused the same pid. */
export const lockOwnerInstanceId = randomUUID()

// Exact records this process currently holds or is publishing. Every record carries a fresh
// nonce, so a record stamped with this process's instance id that is absent here is a leftover
// whose release unlink failed: released, not held.
const heldLockRecords = new Set<string>()

export type ObservedLockRecord = {
  readonly content: string
  readonly modifiedAtEpochMs: number
}

type LockOwner = {
  readonly ownerPid: number
  readonly acquiredAtEpochMs: number
  readonly instanceId: string | null
}

export function buildLockRecord(ownerTag: string): string {
  return `${ownerTag} ${randomUUID()}\n${process.pid}\n${Date.now()}\n${lockOwnerInstanceId}\n`
}

export function markLockRecordHeld(content: string): void {
  heldLockRecords.add(content)
}

export function markLockRecordReleased(content: string): void {
  heldLockRecords.delete(content)
}

export function errorCode(error: unknown): string | null {
  if (!(error instanceof Error) || !("code" in error)) return null
  return typeof error.code === "string" ? error.code : null
}

export function isPathAbsenceError(error: unknown): boolean {
  const code = errorCode(error)
  return code === "ENOENT" || code === "ENOTDIR"
}

function parseLockOwner(content: string): LockOwner | null {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 3 && lines.length !== 4) return null

  const ownerPid = Number.parseInt(lines[1] ?? "", 10)
  const acquiredAtEpochMs = Number.parseInt(lines[2] ?? "", 10)
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return null
  if (!Number.isInteger(acquiredAtEpochMs) || acquiredAtEpochMs <= 0) return null

  return {
    ownerPid,
    acquiredAtEpochMs,
    instanceId: lines.length === 4 ? (lines[3] ?? null) : null,
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return false
  }
}

/** Returns null when the lock file is absent or unreadable; an unreadable lock is never stale. */
export async function readLockRecord(lockPath: string): Promise<ObservedLockRecord | null> {
  try {
    const content = await readFile(lockPath, "utf8")
    const { mtimeMs } = await stat(lockPath)
    return { content, modifiedAtEpochMs: mtimeMs }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

/**
 * A record is stale only on proof that its owner is gone. A live pid is never stale however old
 * its record is, so a slow holder cannot lose its lock. Age decides only where no owner can be
 * checked: an unparseable record (a live owner writes its record right after the exclusive
 * create, so it is torn only after a crash) and a legacy 3-line record whose pid is dead.
 */
export function isLockRecordStale(record: ObservedLockRecord, staleAfterMs: number): boolean {
  const owner = parseLockOwner(record.content)
  if (owner === null) return Date.now() - record.modifiedAtEpochMs > staleAfterMs

  // Our pid with a foreign instance id is this process number recycled after the previous
  // owner died; our own instance id is live only while that exact record is held here.
  if (owner.instanceId !== null && owner.ownerPid === process.pid) {
    return owner.instanceId !== lockOwnerInstanceId || !heldLockRecords.has(record.content)
  }

  if (isPidAlive(owner.ownerPid)) return false
  if (owner.instanceId !== null) return true
  return Date.now() - owner.acquiredAtEpochMs > staleAfterMs
}
