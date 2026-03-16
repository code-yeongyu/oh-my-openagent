import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  writeSync,
  unlinkSync,
  statSync,
  constants,
} from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { randomUUID } from "crypto"

const REGISTRY_PATH = join(homedir(), ".omx", "state", "reply-session-registry.jsonl")
const REGISTRY_LOCK_PATH = join(homedir(), ".omx", "state", "reply-session-registry.lock")
const SECURE_FILE_MODE = 0o600
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const LOCK_TIMEOUT_MS = 2000
const LOCK_WAIT_TIMEOUT_MS = 4000
const LOCK_RETRY_MS = 20
const LOCK_STALE_MS = 10000

export interface SessionMapping {
  sessionId: string
  tmuxSession: string
  tmuxPaneId: string
  projectPath: string
  platform: string
  messageId: string
  channelId?: string
  threadId?: string
  createdAt: string
}

function ensureRegistryDir(): void {
  const registryDir = dirname(REGISTRY_PATH)
  if (!existsSync(registryDir)) {
    mkdirSync(registryDir, { recursive: true, mode: 0o700 })
  }
}

function sleepMs(ms: number): void {
  // Use Atomics.wait for synchronous sleep
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

interface LockSnapshot {
  raw: string
  pid: number | null
  token: string | null
}

function readLockSnapshot(): LockSnapshot | null {
  try {
    if (!existsSync(REGISTRY_LOCK_PATH)) return null
    const raw = readFileSync(REGISTRY_LOCK_PATH, "utf-8")
    const trimmed = raw.trim()
    if (!trimmed) return { raw, pid: null, token: null }

    try {
      const parsed = JSON.parse(trimmed)
      const pid =
        typeof parsed.pid === "number" && Number.isFinite(parsed.pid) ? parsed.pid : null
      const token =
        typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : null
      return { raw, pid, token }
    } catch {
      // Legacy format or plain PID
      const [pidStr] = trimmed.split(":")
      const parsedPid = Number.parseInt(pidStr ?? "", 10)
      return {
        raw,
        pid: Number.isFinite(parsedPid) && parsedPid > 0 ? parsedPid : null,
        token: null,
      }
    }
  } catch {
    return null
  }
}

function removeLockIfUnchanged(snapshot: LockSnapshot): boolean {
  try {
    if (!existsSync(REGISTRY_LOCK_PATH)) return false
    const currentRaw = readFileSync(REGISTRY_LOCK_PATH, "utf-8")
    if (currentRaw !== snapshot.raw) return false
    unlinkSync(REGISTRY_LOCK_PATH)
    return true
  } catch {
    return false
  }
}

interface LockHandle {
  fd: number
  token: string
}

function acquireRegistryLock(): LockHandle | null {
  ensureRegistryDir()
  const started = Date.now()
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    try {
      const token = randomUUID()
      const fd = openSync(
        REGISTRY_LOCK_PATH,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        SECURE_FILE_MODE,
      )
      const lockPayload = JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
        token,
      })
      writeSync(fd, lockPayload)
      return { fd, token }
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code !== "EEXIST") throw error

      try {
        const stats = statSync(REGISTRY_LOCK_PATH)
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
      } catch {
        // Ignore errors
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
  try {
    closeSync(lock.fd)
  } catch {
    // Ignore
  }
  const snapshot = readLockSnapshot()
  if (!snapshot || snapshot.token !== lock.token) return
  removeLockIfUnchanged(snapshot)
}

function withRegistryLockOrWait<T>(
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

function withRegistryLock(onLocked: () => void, onLockUnavailable: () => void): void {
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

function readAllMappingsUnsafe(): SessionMapping[] {
  if (!existsSync(REGISTRY_PATH)) return []
  try {
    const content = readFileSync(REGISTRY_PATH, "utf-8")
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as SessionMapping
        } catch {
          return null
        }
      })
      .filter((m): m is SessionMapping => m !== null)
  } catch {
    return []
  }
}

function rewriteRegistryUnsafe(mappings: SessionMapping[]): void {
  ensureRegistryDir()
  if (mappings.length === 0) {
    writeFileSync(REGISTRY_PATH, "", { mode: SECURE_FILE_MODE })
    return
  }
  const content = mappings.map((m) => JSON.stringify(m)).join("\n") + "\n"
  writeFileSync(REGISTRY_PATH, content, { mode: SECURE_FILE_MODE })
}

export function registerMessage(mapping: SessionMapping): boolean {
  return withRegistryLockOrWait(
    () => {
      ensureRegistryDir()
      const line = JSON.stringify(mapping) + "\n"
      const fd = openSync(
        REGISTRY_PATH,
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
        SECURE_FILE_MODE,
      )
      try {
        writeSync(fd, line)
      } finally {
        closeSync(fd)
      }
      return true
    },
    () => {
      console.warn(
        "[notifications] session registry lock unavailable; skipping reply correlation write",
      )
      return false
    },
  )
}

export function loadAllMappings(): SessionMapping[] {
  return withRegistryLockOrWait(
    () => readAllMappingsUnsafe(),
    () => [],
  )
}

export function lookupByMessageId(platform: string, messageId: string): SessionMapping | null {
  const mappings = loadAllMappings()
  return mappings.find((m) => m.platform === platform && m.messageId === messageId) || null
}

export function removeSession(sessionId: string): void {
  withRegistryLock(
    () => {
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((m) => m.sessionId !== sessionId)
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {
      // Best-effort
    },
  )
}

export function removeMessagesByPane(paneId: string): void {
  withRegistryLock(
    () => {
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((m) => m.tmuxPaneId !== paneId)
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {
      // Best-effort
    },
  )
}

export function pruneStale(): void {
  withRegistryLock(
    () => {
      const now = Date.now()
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((m) => {
        try {
          const age = now - new Date(m.createdAt).getTime()
          return age < MAX_AGE_MS
        } catch {
          return false
        }
      })
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {
      // Best-effort
    },
  )
}
