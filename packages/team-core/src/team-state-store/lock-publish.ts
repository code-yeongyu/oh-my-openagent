import { access, open, unlink } from "node:fs/promises"
import { dirname } from "node:path"

import { errorCode, isPathAbsenceError, markLockRecordHeld, markLockRecordReleased } from "./lock-record"

type LockOpenErrorDeps = {
  readonly access?: typeof access
  readonly platform?: NodeJS.Platform
}

async function pathMayExist(path: string, deps: LockOpenErrorDeps = {}): Promise<boolean> {
  const accessPath = deps.access ?? access
  try {
    await accessPath(path)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return !isPathAbsenceError(error)
  }
}

export async function assertRetryableLockOpenError(
  lockPath: string,
  error: unknown,
  deps?: LockOpenErrorDeps,
): Promise<void> {
  const code = errorCode(error)
  if (code === "EEXIST") return
  if (code === "EPERM") {
    if (await pathMayExist(lockPath, deps)) return
    if ((deps?.platform ?? process.platform) === "win32" && (await pathMayExist(dirname(lockPath), deps))) return
  }
  throw error
}

/**
 * Creates the lock file exclusively and writes `record` into it. Returns false when another
 * record already owns the path. The exclusive create is the only thing that grants a lock.
 *
 * No fsync: contenders read the record through the shared page cache, so durability adds
 * nothing to exclusion, and FlushFileBuffers under Windows disk load cost seconds per acquire
 * (#9030). A record torn by an OS crash is reclaimed by age (see isLockRecordStale).
 */
export async function publishLockRecord(lockPath: string, record: string): Promise<boolean> {
  markLockRecordHeld(record)
  let fileHandle: Awaited<ReturnType<typeof open>>
  try {
    fileHandle = await open(lockPath, "wx")
  } catch (error) {
    markLockRecordReleased(record)
    await assertRetryableLockOpenError(lockPath, error)
    return false
  }

  try {
    await fileHandle.writeFile(record)
  } catch (error) {
    markLockRecordReleased(record)
    await fileHandle.close()
    await unlink(lockPath).catch(() => undefined)
    throw error
  }
  await fileHandle.close()
  return true
}
