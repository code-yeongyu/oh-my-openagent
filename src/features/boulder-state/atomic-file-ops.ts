import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

const STALE_LOCK_THRESHOLD_MS = 30_000

export function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const tempPath = `${filePath}.tmp.${randomUUID()}`

  try {
    writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // cleanup errors are not actionable
    }
    throw error
  }
}

export function atomicWriteText(filePath: string, content: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const tempPath = `${filePath}.tmp.${randomUUID()}`

  try {
    writeFileSync(tempPath, content, "utf-8")
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // cleanup errors are not actionable
    }
    throw error
  }
}

export function withFileLock<T>(lockDir: string, fn: () => T): T {
  const lockPath = join(lockDir, ".lock")
  const lockId = randomUUID()

  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true })
  }

  const tryCreate = (timestamp: number): boolean => {
    try {
      writeFileSync(lockPath, JSON.stringify({ id: lockId, timestamp }), {
        encoding: "utf-8",
        flag: "wx",
      })
      return true
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        return false
      }
      throw error
    }
  }

  const isStale = (): boolean => {
    try {
      const lockContent = readFileSync(lockPath, "utf-8")
      const lockData = JSON.parse(lockContent)
      return Date.now() - lockData.timestamp > STALE_LOCK_THRESHOLD_MS
    } catch {
      return true
    }
  }

  const release = () => {
    try {
      if (!existsSync(lockPath)) return
      const lockContent = readFileSync(lockPath, "utf-8")
      const lockData = JSON.parse(lockContent)
      if (lockData.id !== lockId) return
      unlinkSync(lockPath)
    } catch {
      // cleanup errors are not actionable
    }
  }

  let acquired = tryCreate(Date.now())
  if (!acquired && isStale()) {
    try {
      unlinkSync(lockPath)
    } catch {
      // concurrent removal is fine
    }
    acquired = tryCreate(Date.now())
  }

  if (!acquired) {
    throw new Error(`Failed to acquire file lock at ${lockPath}`)
  }

  try {
    return fn()
  } finally {
    release()
  }
}
