import { join, dirname } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { log } from "../../shared/logger"
import type { SessionAliasFile } from "./types"

const STORAGE_FILENAME = "session-aliases.json"
const STALE_LOCK_THRESHOLD_MS = 30_000

export interface StoragePathOptions {
  /** Project directory (usually ctx.directory). Defaults to process.cwd(). */
  directory?: string
}

export function getSessionAliasStoragePath(options: StoragePathOptions = {}): string {
  const dir = options.directory ?? process.cwd()
  return join(dir, ".opencode", STORAGE_FILENAME)
}

function emptyFile(): SessionAliasFile {
  return { version: 1, aliases: {} }
}

export function readAliasFile(path: string): SessionAliasFile {
  try {
    if (!existsSync(path)) return emptyFile()
    const raw = readFileSync(path, "utf-8")
    if (!raw.trim()) return emptyFile()
    const parsed = JSON.parse(raw) as Partial<SessionAliasFile>
    if (!parsed || typeof parsed !== "object") return emptyFile()
    if (parsed.version !== 1 || !parsed.aliases || typeof parsed.aliases !== "object") {
      log("[session-alias] unexpected file format, starting fresh", { path, version: parsed.version })
      return emptyFile()
    }
    // Defensive filter: drop entries that don't match shape
    const sanitized: SessionAliasFile = { version: 1, aliases: {} }
    for (const [key, value] of Object.entries(parsed.aliases)) {
      if (
        value &&
        typeof value === "object" &&
        typeof (value as { alias?: unknown }).alias === "string" &&
        typeof (value as { session_id?: unknown }).session_id === "string" &&
        typeof (value as { created_at?: unknown }).created_at === "number"
      ) {
        sanitized.aliases[key] = value as SessionAliasFile["aliases"][string]
      }
    }
    return sanitized
  } catch (e) {
    log("[session-alias] failed to read alias file, starting fresh", { path, error: String(e) })
    return emptyFile()
  }
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

export function writeAliasFileAtomic(path: string, data: SessionAliasFile): void {
  ensureDir(dirname(path))
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8")
    renameSync(tmp, path)
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // ignore cleanup failures
    }
    throw e
  }
}

export interface LockHandle {
  acquired: boolean
  release: () => void
}

export function acquireFileLock(targetPath: string): LockHandle {
  const lockPath = `${targetPath}.lock`
  ensureDir(dirname(lockPath))
  const lockId = randomUUID()

  const tryCreate = (): boolean => {
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({ id: lockId, timestamp: Date.now(), pid: process.pid }),
        { encoding: "utf-8", flag: "wx" },
      )
      return true
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "EEXIST") return false
      throw e
    }
  }

  const isStale = (): boolean => {
    try {
      const raw = readFileSync(lockPath, "utf-8")
      const data = JSON.parse(raw) as { timestamp?: number }
      if (typeof data.timestamp !== "number") return true
      return Date.now() - data.timestamp > STALE_LOCK_THRESHOLD_MS
    } catch {
      return true
    }
  }

  let acquired = tryCreate()
  if (!acquired && isStale()) {
    try {
      unlinkSync(lockPath)
    } catch {
      // another process may have cleaned it
    }
    acquired = tryCreate()
  }

  if (!acquired) {
    return { acquired: false, release: () => {} }
  }

  return {
    acquired: true,
    release: () => {
      try {
        if (!existsSync(lockPath)) return
        const raw = readFileSync(lockPath, "utf-8")
        const data = JSON.parse(raw) as { id?: string }
        if (data.id !== lockId) return
        unlinkSync(lockPath)
      } catch {
        // ignore
      }
    },
  }
}

/**
 * Read-modify-write helper with file locking. The mutator receives the current
 * state and must return the new state (or null to abort the write).
 */
export async function mutateAliasFile(
  path: string,
  mutator: (current: SessionAliasFile) => SessionAliasFile | null,
): Promise<{ ok: true; file: SessionAliasFile } | { ok: false; reason: string }> {
  const lock = acquireFileLock(path)
  if (!lock.acquired) {
    return { ok: false, reason: "Could not acquire lock on alias file (another process is holding it)." }
  }
  try {
    const current = readAliasFile(path)
    const next = mutator(current)
    if (next === null) return { ok: true, file: current }
    writeAliasFileAtomic(path, next)
    return { ok: true, file: next }
  } finally {
    lock.release()
  }
}
