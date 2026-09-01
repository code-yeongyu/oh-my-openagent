import { closeSync, openSync, rmSync, statSync, utimesSync, writeSync } from "node:fs"

const LOCK_RETRY_MS = 10
const LOCK_WAIT_TIMEOUT_MS = 1_000
// The lock guards a sub-10ms record read-modify-write. Any lock file older than this window was
// left behind by a crashed or wedged holder; age (file mtime) is the staleness authority because a
// pid probe can false-alive after pid reuse and a partially written lock file has no parseable
// content. The pid+timestamp body below is diagnostic only.
const LOCK_STALE_MS = 5_000
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

export function withTaskRecordLock<T>(recordPath: string, operation: () => T): T {
  const lockPath = `${recordPath}.lock`
  acquireLock(lockPath)
  try {
    return operation()
  } finally {
    rmSync(lockPath, { force: true })
  }
}

export async function withTaskRecordLockAsync<T>(recordPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${recordPath}.lock`
  await acquireLockAsync(lockPath)
  const heartbeat = setInterval(() => refreshLock(lockPath), LOCK_STALE_MS / 2)
  heartbeat.unref()
  try {
    return await operation()
  } finally {
    clearInterval(heartbeat)
    rmSync(lockPath, { force: true })
  }
}

function acquireLock(lockPath: string): void {
  const startedAt = Date.now()
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx")
      try {
        writeSync(fd, `${process.pid}\n${Date.now()}\n`)
      } finally {
        closeSync(fd)
      }
      return
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error
      if (isStaleLock(lockPath)) {
        rmSync(lockPath, { force: true })
        continue
      }
      if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out acquiring task record lock: ${lockPath}`)
      }
      Atomics.wait(sleeper, 0, 0, LOCK_RETRY_MS)
    }
  }
}

async function acquireLockAsync(lockPath: string): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx")
      try {
        writeSync(fd, `${process.pid}\n${Date.now()}\n`)
      } finally {
        closeSync(fd)
      }
      return
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error
      if (isStaleLock(lockPath)) {
        rmSync(lockPath, { force: true })
        continue
      }
      if (Date.now() - startedAt >= LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out acquiring task record lock: ${lockPath}`)
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }
}

function refreshLock(lockPath: string): void {
  const now = new Date()
  try {
    utimesSync(lockPath, now, now)
  } catch (error) {
    if (!hasCode(error, "ENOENT")) console.error("Task record lock heartbeat failed", error)
  }
}

function isStaleLock(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS
  } catch (error) {
    // A lock that vanished between the EEXIST and this stat was released; let the loop retry.
    if (hasCode(error, "ENOENT")) return true
    return false
  }
}

function hasCode(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected
}
