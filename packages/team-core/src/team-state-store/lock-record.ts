import { randomUUID } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { getPidLiveness, getProcessStartIdentity, startIdentitiesConflict } from "@oh-my-opencode/memory-core/process-identity"

import { isWorkerLockReleased, lockOwnerInstanceId, registerLockWorker } from "./lock-worker-lifetime"
export { lockOwnerInstanceId, markLockRecordHeld, markLockRecordReleased, forgetLockRecord } from "./lock-worker-lifetime"

export type ObservedLockRecord = {
  readonly content: string
  readonly modifiedAtEpochMs: number
}

type LockOwner = {
  readonly ownerPid: number
  readonly acquiredAtEpochMs: number
  readonly instanceId: string | null
  readonly processStart: string | null
}

export async function buildLockRecord(ownerTag: string): Promise<string> {
  await registerLockWorker()
  const processStart = await getProcessStartIdentity(process.pid)
  return `${ownerTag} ${randomUUID()}\n${process.pid}\n${Date.now()}\n${lockOwnerInstanceId}\n${processStart ?? "unavailable"}\n`
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
  if (lines.length !== 3 && lines.length !== 4 && lines.length !== 5) return null

  const ownerPid = Number.parseInt(lines[1] ?? "", 10)
  const acquiredAtEpochMs = Number.parseInt(lines[2] ?? "", 10)
  if (!Number.isInteger(ownerPid) || ownerPid <= 0) return null
  if (!Number.isInteger(acquiredAtEpochMs) || acquiredAtEpochMs <= 0) return null

  return {
    ownerPid,
    acquiredAtEpochMs,
    instanceId: lines[3] ?? null,
    processStart: lines[4] ?? null,
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
export async function isLockRecordStale(record: ObservedLockRecord, staleAfterMs: number): Promise<boolean> {
  const owner = parseLockOwner(record.content)
  if (owner === null) return Date.now() - record.modifiedAtEpochMs > staleAfterMs

  const liveness = getPidLiveness(owner.ownerPid)
  if (liveness === "dead") {
    return owner.instanceId !== null || Date.now() - owner.acquiredAtEpochMs > staleAfterMs
  }
  if (liveness === "unknown") return false
  if (owner.processStart !== null) {
    const actual = await getProcessStartIdentity(owner.ownerPid)
    if (actual !== null && startIdentitiesConflict(owner.processStart, actual)) return true
  }
  if (owner.instanceId !== null && owner.ownerPid === process.pid) {
    return await isWorkerLockReleased(owner.instanceId, record.content)
  }
  return false
}
