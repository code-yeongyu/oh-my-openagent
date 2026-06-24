import { constants, closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "fs"
import { randomUUID } from "crypto"
import {
  getRegistryLockPath,
  LOCK_RETRY_MS,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  LOCK_WAIT_TIMEOUT_MS,
  SECURE_FILE_MODE,
} from "./session-registry-paths"
import { ensureRegistryDir } from "./session-registry-storage"

interface LockSnapshot {
  raw: string
  pid: number | null
  token: string | null
}

interface LockHandle {
  fd: number
  token: string
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      return error.code === "EPERM"
    }
    return false
  }
}

function readLockSnapshot(): LockSnapshot | null {
  try {
    const registryLockPath = getRegistryLockPath()
    if (!existsSync(registryLockPath)) return null
    const raw = readFileSync(registryLockPath, "utf-8")
    const trimmed = raw.trim()
    if (!trimmed) return { raw, pid: null, token: null }

    try {
      const parsed = JSON.parse(trimmed)
      const pid =
        typeof parsed.pid === "number" && Number.isFinite(parsed.pid) ? parsed.pid : null
      const token =
        typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null
      return { raw, pid, token }
    } catch (error) {
      if (!(error instanceof SyntaxError)) return null
      const [pidStr] = trimmed.split(":")
      const parsedPid = Number.parseInt(pidStr ?? "", 10)
      return {
        raw,
        pid: Number.isFinite(parsedPid) && parsedPid > 0 ? parsedPid : null,
        token: null,
      }
    }
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

function removeLockIfUnchanged(snapshot: LockSnapshot): boolean {
  try {
    const registryLockPath = getRegistryLockPath()
    if (!existsSync(registryLockPath)) return false
    const currentRaw = readFileSync(registryLockPath, "utf-8")
    if (currentRaw !== snapshot.raw) return false
    unlinkSync(registryLockPath)
    return true
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function closeLockFd(fd: number): void {
  try {
    closeSync(fd)
  } catch (error) {
    if (error instanceof Error) return
  }
}

function unlinkLockFile(): void {
  try {
    unlinkSync(getRegistryLockPath())
  } catch (error) {
    if (error instanceof Error) return
  }
}

function acquireRegistryLock(): LockHandle | null {
  ensureRegistryDir()
  const started = Date.now()
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    try {
      const token = randomUUID()
      const fd = openSync(
        getRegistryLockPath(),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        SECURE_FILE_MODE,
      )
      try {
        const lockPayload = JSON.stringify({
          pid: process.pid,
          acquiredAt: Date.now(),
          token,
        })
        writeSync(fd, lockPayload)
      } catch (writeError) {
        closeLockFd(fd)
        unlinkLockFile()
        throw writeError
      }
      return { fd, token }
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error
      if (error.code !== "EEXIST") throw error

      try {
        const stats = statSync(getRegistryLockPath())
        const lockAgeMs = Date.now() - stats.mtimeMs
        if (lockAgeMs > LOCK_STALE_MS) {
          const snapshot = readLockSnapshot()
          if (!snapshot) {
            sleepMs(LOCK_RETRY_MS)
            continue
          }
          if (snapshot.pid !== null && isPidAlive(snapshot.pid)) {
            sleepMs(LOCK_RETRY_MS)
            continue
          }
          if (removeLockIfUnchanged(snapshot)) {
            continue
          }
        }
      } catch (statError) {
        if (!(statError instanceof Error)) throw statError
      }
      sleepMs(LOCK_RETRY_MS)
    }
  }
  return null
}

function acquireRegistryLockOrWait(maxWaitMs = LOCK_WAIT_TIMEOUT_MS): LockHandle | null {
  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    const lock = acquireRegistryLock()
    if (lock !== null) return lock
    if (Date.now() - started < maxWaitMs) {
      sleepMs(LOCK_RETRY_MS)
    }
  }
  return null
}

function releaseRegistryLock(lock: LockHandle): void {
  closeLockFd(lock.fd)
  const snapshot = readLockSnapshot()
  if (!snapshot || snapshot.token !== lock.token) return
  removeLockIfUnchanged(snapshot)
}

export function withRegistryLockOrWait<T>(
  onLocked: () => T,
  onLockUnavailable: () => T,
): T {
  const lock = acquireRegistryLockOrWait()
  if (lock === null) return onLockUnavailable()
  try {
    return onLocked()
  } finally {
    releaseRegistryLock(lock)
  }
}

export function withRegistryLock(onLocked: () => void, onLockUnavailable: () => void): void {
  const lock = acquireRegistryLock()
  if (lock === null) {
    onLockUnavailable()
    return
  }
  try {
    onLocked()
  } finally {
    releaseRegistryLock(lock)
  }
}
