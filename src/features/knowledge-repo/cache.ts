import { mkdir, readFile, writeFile, unlink } from "fs/promises"
import { join } from "path"
import type { KnowledgeCommit, KnowledgeManifest } from "./types"

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

interface CacheConfig {
  memoryEnabled: boolean
  diskEnabled: boolean
  ttlMs: number
  diskCacheDir: string
}

const DEFAULT_TTL_MS = 5 * 60 * 1000

export class KnowledgeCache {
  private config: CacheConfig
  private memoryCache: Map<string, CacheEntry<unknown>> = new Map()
  private initialized = false

  constructor(config: Partial<CacheConfig> & { diskCacheDir: string }) {
    this.config = {
      memoryEnabled: config.memoryEnabled ?? true,
      diskEnabled: config.diskEnabled ?? true,
      ttlMs: config.ttlMs ?? DEFAULT_TTL_MS,
      diskCacheDir: config.diskCacheDir,
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.config.diskEnabled) {
      await mkdir(this.config.diskCacheDir, { recursive: true })
    }
    this.initialized = true
  }

  async getCommit(id: string): Promise<KnowledgeCommit | null> {
    return this.get<KnowledgeCommit>(`commit:${id}`)
  }

  async setCommit(commit: KnowledgeCommit): Promise<void> {
    await this.set(`commit:${commit.id}`, commit)
  }

  async getManifest(): Promise<KnowledgeManifest | null> {
    return this.get<KnowledgeManifest>("manifest")
  }

  async setManifest(manifest: KnowledgeManifest): Promise<void> {
    await this.set("manifest", manifest)
  }

  async invalidateCommit(id: string): Promise<void> {
    await this.invalidate(`commit:${id}`)
  }

  async invalidateManifest(): Promise<void> {
    await this.invalidate("manifest")
  }

  async clear(): Promise<void> {
    this.memoryCache.clear()
    if (this.config.diskEnabled) {
      const { readdir, unlink } = await import("fs/promises")
      try {
        const files = await readdir(this.config.diskCacheDir)
        await Promise.all(
          files
            .filter((f) => f.endsWith(".cache.json"))
            .map((f) => unlink(join(this.config.diskCacheDir, f)).catch(() => {}))
        )
      } catch {
        /* empty */
      }
    }
  }

  private async get<T>(key: string): Promise<T | null> {
    if (this.config.memoryEnabled) {
      const memEntry = this.memoryCache.get(key)
      if (memEntry && memEntry.expiresAt > Date.now()) {
        return memEntry.data as T
      }
      if (memEntry) {
        this.memoryCache.delete(key)
      }
    }

    if (this.config.diskEnabled) {
      try {
        const diskPath = this.getDiskPath(key)
        const data = await readFile(diskPath, "utf-8")
        const entry = JSON.parse(data) as CacheEntry<T>
        if (entry.expiresAt > Date.now()) {
          if (this.config.memoryEnabled) {
            this.memoryCache.set(key, entry)
          }
          return entry.data
        }
        await unlink(diskPath).catch(() => {})
      } catch {
        /* empty */
      }
    }

    return null
  }

  private async set<T>(key: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      expiresAt: Date.now() + this.config.ttlMs,
    }

    if (this.config.memoryEnabled) {
      this.memoryCache.set(key, entry)
    }

    if (this.config.diskEnabled) {
      const diskPath = this.getDiskPath(key)
      await writeFile(diskPath, JSON.stringify(entry), "utf-8")
    }
  }

  private async invalidate(key: string): Promise<void> {
    this.memoryCache.delete(key)

    if (this.config.diskEnabled) {
      const diskPath = this.getDiskPath(key)
      await unlink(diskPath).catch(() => {})
    }
  }

  private getDiskPath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, "_")
    return join(this.config.diskCacheDir, `${safeKey}.cache.json`)
  }
}
