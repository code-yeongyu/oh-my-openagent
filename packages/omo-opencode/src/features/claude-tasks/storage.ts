import { join, dirname, basename, isAbsolute } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "fs"
import { randomUUID } from "crypto"
import { getOpenCodeConfigDir } from "../../shared/opencode-config-dir"
import type { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../config/schema"

function ignoreClaudeTaskStorageError(error: unknown): void {
  if (error instanceof Error) return
  throw error
}

export function getTaskDir(config: Partial<OhMyOpenCodeConfig> = {}): string {
  const tasksConfig = config.sisyphus?.tasks
  const storagePath = tasksConfig?.storage_path

  if (storagePath) {
    return isAbsolute(storagePath) ? storagePath : join(process.cwd(), storagePath)
  }

  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  const listId = resolveTaskListId(config)
  return join(configDir, "tasks", listId)
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-") || "default"
}

export function resolveTaskListId(config: Partial<OhMyOpenCodeConfig> = {}): string {
  const envId = process.env.ULTRAWORK_TASK_LIST_ID?.trim()
  if (envId) return sanitizePathSegment(envId)

  const claudeEnvId = process.env.CLAUDE_CODE_TASK_LIST_ID?.trim()
  if (claudeEnvId) return sanitizePathSegment(claudeEnvId)

  const configId = config.sisyphus?.tasks?.task_list_id?.trim()
  if (configId) return sanitizePathSegment(configId)

  return sanitizePathSegment(basename(process.cwd()))
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

export function readJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null {
  try {
    if (!existsSync(filePath)) {
      return null
    }

    const content = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(content)
    const result = schema.safeParse(parsed)

    if (!result.success) {
      return null
    }

    return result.data
  } catch (error) {
    ignoreClaudeTaskStorageError(error)
    return null
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  ensureDir(dir)

  const tempPath = `${filePath}.tmp.${Date.now()}`

  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch (cleanupError) {
      ignoreClaudeTaskStorageError(cleanupError)
      // Ignore cleanup errors
    }
    throw error
  }
}

// A crashed holder is reclaimed on age alone, and this threshold stays independent of the wait
// bound below so a wedged lock never costs a writer more than one stale check.
const STALE_LOCK_THRESHOLD_MS = 30000
// The critical section is a single atomic JSON write, so ordinary contention clears in
// microseconds; this budget only has to outlast a burst of parallel writers.
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 5000
const DEFAULT_LOCK_RETRY_DELAY_MS = 10
const MAX_LOCK_RETRY_DELAY_MS = 50

export interface AcquireLockOptions {
  waitTimeoutMs?: number
  retryDelayMs?: number
}

export function resolveLockWaitTimeoutMs(): number {
  const raw = process.env.OMO_TASK_LOCK_WAIT_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_LOCK_WAIT_TIMEOUT_MS

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LOCK_WAIT_TIMEOUT_MS

  return parsed
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function generateTaskId(): string {
  return `T-${randomUUID()}`
}

export function listTaskFiles(config: Partial<OhMyOpenCodeConfig> = {}): string[] {
  const dir = getTaskDir(config)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f.startsWith('T-'))
    .map((f) => f.replace('.json', ''))
}

export async function acquireLock(
  dirPath: string,
  options: AcquireLockOptions = {},
): Promise<{ acquired: boolean; release: () => void }> {
  const lockPath = join(dirPath, ".lock")
  const lockId = randomUUID()
  const waitTimeoutMs = options.waitTimeoutMs ?? resolveLockWaitTimeoutMs()
  const baseRetryDelayMs = options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS

  const createLock = (timestamp: number) => {
    writeFileSync(lockPath, JSON.stringify({ id: lockId, timestamp }), {
      encoding: "utf-8",
      flag: "wx",
    })
  }

  const isStale = (lockContent: string) => {
    try {
      const lockData = JSON.parse(lockContent)
      const lockAge = Date.now() - lockData.timestamp
      return lockAge > STALE_LOCK_THRESHOLD_MS
    } catch (error) {
      ignoreClaudeTaskStorageError(error)
      return true
    }
  }

  const reclaimStaleLock = () => {
    let snapshot: string
    try {
      snapshot = readFileSync(lockPath, "utf-8")
    } catch (error) {
      ignoreClaudeTaskStorageError(error)
      // The lock vanished between the failed create and this read: nothing to reclaim, retry now.
      return true
    }

    if (!isStale(snapshot)) return false

    try {
      // Re-read guards the gap between staleness detection and removal so a lock another writer
      // acquired in the meantime is never deleted.
      if (readFileSync(lockPath, "utf-8") !== snapshot) return false
      unlinkSync(lockPath)
    } catch (error) {
      ignoreClaudeTaskStorageError(error)
      // Ignore cleanup errors
    }
    return true
  }

  const tryAcquire = () => {
    const now = Date.now()
    try {
      createLock(now)
      return true
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return false
      }
      throw error
    }
  }

  const nextDelayMs = (attempt: number, deadline: number) => {
    const cap = Math.max(MAX_LOCK_RETRY_DELAY_MS, baseRetryDelayMs)
    const step = Math.min(baseRetryDelayMs * 2 ** attempt, cap)
    // Jitter keeps a burst of parallel writers from retrying in lockstep.
    const jittered = step / 2 + Math.random() * (step / 2)
    return Math.max(1, Math.min(jittered, deadline - Date.now()))
  }

  ensureDir(dirPath)

  const deadline = Date.now() + waitTimeoutMs
  let acquired = false
  for (let attempt = 0; ; attempt++) {
    if (tryAcquire()) {
      acquired = true
      break
    }
    // Stale reclaim runs on every pass, so a crashed holder is cleared as soon as it ages out
    // instead of consuming the whole wait budget.
    if (reclaimStaleLock() && tryAcquire()) {
      acquired = true
      break
    }
    if (Date.now() >= deadline) break
    await delay(nextDelayMs(attempt, deadline))
  }

  if (!acquired) {
    return {
      acquired: false,
      release: () => {
        // No-op release for failed acquisition
      },
    }
  }

  return {
    acquired: true,
    release: () => {
      try {
        if (!existsSync(lockPath)) return
        const lockContent = readFileSync(lockPath, "utf-8")
        const lockData = JSON.parse(lockContent)
        if (lockData.id !== lockId) return
        unlinkSync(lockPath)
      } catch (error) {
        ignoreClaudeTaskStorageError(error)
        // Ignore cleanup errors
      }
    },
  }
}
