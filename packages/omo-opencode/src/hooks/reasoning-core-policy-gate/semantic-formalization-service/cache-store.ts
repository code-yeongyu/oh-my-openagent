import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Theory } from "./types"

type CachedTheory = {
  theory: Theory
  createdAt: number
  modelId: string
  promptVersion: string
  schemaVersion: number
}

type Logger = {
  warn(msg: string, meta?: Record<string, unknown>): void
  debug(msg: string, meta?: Record<string, unknown>): void
}

type CacheStoreDeps = {
  logger: Logger
  persistence?: "memory" | "fs"
  fsBasePath?: string
}

export type CacheStore = {
  get(key: string): CachedTheory | undefined
  set(key: string, value: CachedTheory): void
  has(key: string): boolean
  delete(key: string): boolean
}

export function createCacheStore(deps: CacheStoreDeps): CacheStore {
  const { logger, fsBasePath = ".sisyphus/cache/themis" } = deps
  const persistence = deps.persistence ?? (process.env.THEMIS_CACHE_FS === "1" ? "fs" : "memory")
  const memStore = new Map<string, CachedTheory>()

  function getFsPath(key: string): string {
    return join(fsBasePath, `${key}.json`)
  }

  function readFs(key: string): CachedTheory | undefined {
    try {
      return JSON.parse(readFileSync(getFsPath(key), "utf8")) as CachedTheory
    } catch {
      return undefined
    }
  }

  function writeFs(key: string, value: CachedTheory): void {
    const path = getFsPath(key)
    const tmpPath = `${path}.tmp`

    try {
      mkdirSync(fsBasePath, { recursive: true })
      writeFileSync(tmpPath, JSON.stringify(value))
      renameSync(tmpPath, path)
      logger.debug("cache-store: wrote to fs", { key })
    } catch (err) {
      rmSync(tmpPath, { force: true })
      logger.warn("cache-store: fs write failed, falling back to memory", { key, err })
    }
  }

  function deleteFs(key: string): boolean {
    try {
      rmSync(getFsPath(key))

      return true
    } catch {
      return false
    }
  }

  return {
    get(key) {
      const cached = memStore.get(key)
      if (cached) return cached

      if (persistence !== "fs") return undefined

      const persisted = readFs(key)
      if (persisted) memStore.set(key, persisted)

      return persisted
    },
    set(key, value) {
      memStore.set(key, value)

      if (persistence === "fs") writeFs(key, value)
    },
    has(key) {
      if (memStore.has(key)) return true
      if (persistence !== "fs") return false

      return readFs(key) !== undefined
    },
    delete(key) {
      const memDeleted = memStore.delete(key)
      if (persistence !== "fs") return memDeleted

      return deleteFs(key) || memDeleted
    },
  }
}
