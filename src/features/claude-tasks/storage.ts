import { join, dirname } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync } from "fs"
import { randomUUID } from "crypto"
import type { z } from "zod"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function getTaskDir(config: Partial<OhMyOpenCodeConfig> = {}): string {
  const tasksConfig = config.sisyphus?.tasks
  const storagePath = tasksConfig?.storage_path ?? ".sisyphus/tasks"
  return join(process.cwd(), storagePath)
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
  } catch {
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
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

const STALE_LOCK_THRESHOLD_MS = 30000

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

export function acquireLock(dirPath: string): { acquired: boolean; release: () => void } {
  const lockPath = join(dirPath, ".lock")
  const now = Date.now()

  if (existsSync(lockPath)) {
    try {
      const lockContent = readFileSync(lockPath, "utf-8")
      const lockData = JSON.parse(lockContent)
      const lockAge = now - lockData.timestamp

      if (lockAge <= STALE_LOCK_THRESHOLD_MS) {
        return {
          acquired: false,
          release: () => {
            // No-op release for failed acquisition
          },
        }
      }
    } catch {
      // If lock file is corrupted, treat as stale and override
    }
  }

  ensureDir(dirPath)
  writeFileSync(lockPath, JSON.stringify({ timestamp: now }), "utf-8")

  return {
    acquired: true,
    release: () => {
      try {
        if (existsSync(lockPath)) {
          unlinkSync(lockPath)
        }
      } catch {
        // Ignore cleanup errors
      }
    },
  }
}
