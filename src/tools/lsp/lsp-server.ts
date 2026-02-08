import type { ResolvedServer } from "./types"
import { LSPClient } from "./lsp-client"
interface ManagedClient {
  client: LSPClient
  lastUsedAt: number
  refCount: number
  initPromise?: Promise<void>
  isInitializing: boolean
}
class LSPServerManager {
  private static instance: LSPServerManager
  private clients = new Map<string, ManagedClient>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000
  private constructor() {
    this.startCleanupTimer()
    this.registerProcessCleanup()
  }
  private registerProcessCleanup(): void {
    // Synchronous cleanup for 'exit' event (cannot await)
    const syncCleanup = () => {
      for (const [, managed] of this.clients) {
        try {
          // Fire-and-forget during sync exit - process is terminating
          void managed.client.stop().catch(() => {})
        } catch {}
      }
      this.clients.clear()
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }
    }
    // Async cleanup for signal handlers - properly await all stops
    const asyncCleanup = async () => {
      const stopPromises: Promise<void>[] = []
      for (const [, managed] of this.clients) {
        stopPromises.push(managed.client.stop().catch(() => {}))
      }
      await Promise.allSettled(stopPromises)
      this.clients.clear()
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }
    }
    process.on("exit", syncCleanup)

    // Don't call process.exit() here; other handlers (background-agent manager) handle final exit.
    process.on("SIGINT", () => void asyncCleanup().catch(() => {}))
    process.on("SIGTERM", () => void asyncCleanup().catch(() => {}))
    if (process.platform === "win32") {
      process.on("SIGBREAK", () => void asyncCleanup().catch(() => {}))
    }
  }

  static getInstance(): LSPServerManager {
    if (!LSPServerManager.instance) {
      LSPServerManager.instance = new LSPServerManager()
    }
    return LSPServerManager.instance
  }

  private getKey(root: string, serverId: string): string {
    return `${root}::${serverId}`
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleClients()
    }, 60000)
  }

  private cleanupIdleClients(): void {
    const now = Date.now()
    for (const [key, managed] of this.clients) {
      if (managed.refCount === 0 && now - managed.lastUsedAt > this.IDLE_TIMEOUT) {
        managed.client.stop()
        this.clients.delete(key)
      }
    }
  }

  async getClient(root: string, server: ResolvedServer): Promise<LSPClient> {
    const key = this.getKey(root, server.id)
    let managed = this.clients.get(key)
    if (managed) {
      if (managed.initPromise) {
        await managed.initPromise
      }
      if (managed.client.isAlive()) {
        managed.refCount++
        managed.lastUsedAt = Date.now()
        return managed.client
      }
      await managed.client.stop()
      this.clients.delete(key)
    }

    const client = new LSPClient(root, server)
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()
    this.clients.set(key, {
      client,
      lastUsedAt: Date.now(),
      refCount: 1,
      initPromise,
      isInitializing: true,
    })

    await initPromise
    const m = this.clients.get(key)
    if (m) {
      m.initPromise = undefined
      m.isInitializing = false
    }

    return client
  }

  warmupClient(root: string, server: ResolvedServer): void {
    const key = this.getKey(root, server.id)
    if (this.clients.has(key)) return
    const client = new LSPClient(root, server)
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()

    this.clients.set(key, {
      client,
      lastUsedAt: Date.now(),
      refCount: 0,
      initPromise,
      isInitializing: true,
    })

    initPromise.then(() => {
      const m = this.clients.get(key)
      if (m) {
        m.initPromise = undefined
        m.isInitializing = false
      }
    })
  }

  releaseClient(root: string, serverId: string): void {
    const key = this.getKey(root, serverId)
    const managed = this.clients.get(key)
    if (managed && managed.refCount > 0) {
      managed.refCount--
      managed.lastUsedAt = Date.now()
    }
  }

  isServerInitializing(root: string, serverId: string): boolean {
    const key = this.getKey(root, serverId)
    const managed = this.clients.get(key)
    return managed?.isInitializing ?? false
  }

  async stopAll(): Promise<void> {
    for (const [, managed] of this.clients) {
      await managed.client.stop()
    }
    this.clients.clear()
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  async cleanupTempDirectoryClients(): Promise<void> {
    const keysToRemove: string[] = []
    for (const [key, managed] of this.clients.entries()) {
      const isTempDir = key.startsWith("/tmp/") || key.startsWith("/var/folders/")
      const isIdle = managed.refCount === 0
      if (isTempDir && isIdle) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      const managed = this.clients.get(key)
      if (managed) {
        this.clients.delete(key)
        try {
          await managed.client.stop()
        } catch {}
      }
    }
  }
}

export const lspManager = LSPServerManager.getInstance()
