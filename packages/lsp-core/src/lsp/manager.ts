import { reportBestEffortCleanupError } from "./cleanup-errors.js"
import { LspClient } from "./client.js"
import { type ClientIdentity, lspClientKey } from "./client-key.js"
import { awaitWithSignal, ClientStartups, type ManagedClient } from "./client-startup.js"
import {
  CLIENT_RESPAWN_COOLDOWN_MS,
  CLIENT_RESPAWN_RETRY_LIMIT,
  IDLE_TIMEOUT_MS,
  INIT_TIMEOUT_MS,
  MAX_RESIDENT_CLIENTS,
  REAPER_INTERVAL_MS,
} from "./constants.js"
import { LspClientRespawnBudgetExceededError } from "./errors.js"
import { installProcessSignalCleanup } from "./process-signal-cleanup.js"
import { realTimerProvider, repeatEvery, type TimerProvider } from "./timer-provider.js"
import type { ResolvedServer } from "./types.js"

interface RespawnBudget {
  deadGenerations: number
  exhaustedAt: number | null
}

export interface ClientSnapshot {
  root: string
  serverId: string
  refCount: number
  pendingWaiters: number
  lastUsedAt: number
  isInitializing: boolean
  alive: boolean
  command: string[]
}

export interface LspManagerOptions {
  idleTimeoutMs?: number
  initTimeoutMs?: number
  maxResidentClients?: number
  reaperIntervalMs?: number
  clientFactory?: (root: string, server: ResolvedServer) => LspClient
  now?: () => number
  /** Schedules the reaper. */
  timers?: TimerProvider
}

async function stopClientBestEffort(client: LspClient): Promise<void> {
  try {
    await client.stop()
  } catch (error) {
    reportBestEffortCleanupError("client stop", error)
  }
}

export class LspManager {
  private readonly clients = new Map<string, ManagedClient>()
  /** In-flight stops per key; getClient awaits these instead of spawning a duplicate client. */
  private readonly pendingStops = new Map<string, Promise<void>>()
  private readonly respawnBudgets = new Map<string, RespawnBudget>()
  private readonly stopReaper: () => void
  private signalDisposer: (() => void) | null = null
  private disposed = false

  private readonly idleTimeoutMs: number
  private readonly initTimeoutMs: number
  private readonly maxResidentClients: number
  private readonly clientFactory: (root: string, server: ResolvedServer) => LspClient
  private readonly now: () => number
  private readonly startups: ClientStartups

  constructor(options: LspManagerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS
    this.initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS
    this.maxResidentClients = options.maxResidentClients ?? MAX_RESIDENT_CLIENTS
    this.clientFactory = options.clientFactory ?? ((root, server) => new LspClient(root, server))
    this.now = options.now ?? (() => Date.now())
    this.startups = new ClientStartups(this.now, (managed) => this.discard(managed))

    const reaperIntervalMs = options.reaperIntervalMs ?? REAPER_INTERVAL_MS
    this.stopReaper = repeatEvery(options.timers ?? realTimerProvider, reaperIntervalMs, () => this.reapStale())
    this.signalDisposer = installProcessSignalCleanup(() => this.stopAll())
  }

  /**
   * Deletes-then-stops with a tombstone: the pending stop is recorded so a concurrent getClient
   * for the same key awaits it instead of spawning a duplicate client while the old one lingers
   * (production stops reach ~21s). The tombstone removes itself once the stop settles.
   */
  private tombstoneStop(key: string, client: LspClient): Promise<void> {
    const stop = stopClientBestEffort(client)
    this.pendingStops.set(key, stop)
    void stop.finally(() => {
      if (this.pendingStops.get(key) === stop) {
        this.pendingStops.delete(key)
      }
    })
    return stop
  }

  private recordDeadGeneration(key: string): void {
    let budget = this.respawnBudgets.get(key)
    if (budget === undefined) {
      budget = { deadGenerations: 0, exhaustedAt: null }
      this.respawnBudgets.set(key, budget)
    }
    budget.deadGenerations += 1
  }

  private markHealthyGeneration(key: string): void {
    this.respawnBudgets.delete(key)
  }

  /** Throws while the respawn budget is spent and the cooldown has not elapsed. */
  private ensureRespawnAllowed(key: string, root: string, serverId: string): void {
    const budget = this.respawnBudgets.get(key)
    if (budget === undefined || budget.deadGenerations < CLIENT_RESPAWN_RETRY_LIMIT) return
    if (budget.exhaustedAt === null) {
      budget.exhaustedAt = this.now()
      throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT)
    }
    if (this.now() - budget.exhaustedAt < CLIENT_RESPAWN_COOLDOWN_MS) {
      throw new LspClientRespawnBudgetExceededError(serverId, root, CLIENT_RESPAWN_RETRY_LIMIT)
    }
    budget.deadGenerations = 0
    budget.exhaustedAt = null
  }

  private startupExpired(managed: ManagedClient, t: number): boolean {
    return (
      managed.isInitializing && managed.initializingSince !== null && t - managed.initializingSince > this.initTimeoutMs
    )
  }

  private reapStale(): void {
    const t = this.now()
    for (const managed of [...this.clients.values()]) {
      const idle =
        !managed.isInitializing &&
        managed.refCount === 0 &&
        managed.pendingWaiters === 0 &&
        t - managed.lastUsedAt > this.idleTimeoutMs
      if (idle || this.startupExpired(managed, t)) this.discard(managed)
    }
  }

  /**
   * Frees capacity for one new client by stopping the least recently used idle client.
   *
   * Only clients with no in-flight work are eligible, so a resident server is never torn down
   * underneath a live request; when every resident client is busy the cap is exceeded instead.
   */
  private evictForAdmission(): void {
    while (this.clients.size >= this.maxResidentClients) {
      const victim = this.leastRecentlyUsedIdleClient()
      if (!victim) return
      this.discard(victim)
    }
  }

  private leastRecentlyUsedIdleClient(): ManagedClient | null {
    let candidate: ManagedClient | null = null
    for (const managed of this.clients.values()) {
      if (managed.refCount > 0 || managed.pendingWaiters > 0 || managed.isInitializing) continue
      if (candidate === null || managed.lastUsedAt < candidate.lastUsedAt) candidate = managed
    }
    return candidate
  }

  /** Drops `managed` from the pool and stops it as a tracked tombstone, once; nothing here awaits the stop. */
  private discard(managed: ManagedClient): void {
    if (this.clients.get(managed.key) !== managed) return
    this.clients.delete(managed.key)
    void this.tombstoneStop(managed.key, managed.client)
  }

  /** Every await here happens before the acquisition counts or while it counts as a waiter (client-startup.ts). */
  async getClient(root: string, server: ResolvedServer, signal?: AbortSignal): Promise<LspClient> {
    const key = lspClientKey(root, server)
    for (;;) {
      if (this.disposed) {
        throw new Error("LspManager has been disposed")
      }
      signal?.throwIfAborted()
      const pendingStop = this.pendingStops.get(key)
      if (pendingStop !== undefined) {
        await awaitWithSignal(pendingStop, signal)
        continue
      }
      let managed = this.clients.get(key)
      if (managed !== undefined && this.startupExpired(managed, this.now())) {
        this.discard(managed)
        continue
      }
      if (managed === undefined) {
        this.evictForAdmission()
        this.ensureRespawnAllowed(key, root, server.id)
        managed = this.startClient(key, root, server, true)
      }

      const { initPromise } = managed
      if (initPromise !== null) {
        await this.startups.wait(managed, initPromise, signal)
        if (signal?.aborted) {
          this.startups.detach(managed)
          signal.throwIfAborted()
        }
        managed.pendingWaiters--
      }
      // No await from the waiter's uncounting above to the reference below.
      if (this.clients.get(key) !== managed) continue
      if (!managed.client.isAlive()) {
        this.recordDeadGeneration(key)
        this.discard(managed)
        continue
      }
      this.markHealthyGeneration(key)
      managed.refCount++
      managed.lastUsedAt = this.now()
      return managed.client
    }
  }

  private startClient(key: string, root: string, server: ResolvedServer, heldByWaiters: boolean): ManagedClient {
    const client = this.clientFactory(root, server)
    const managed = this.startups.begin({ key, root, serverId: server.id, client, heldByWaiters })
    this.clients.set(key, managed)
    return managed
  }

  /** Gives back the reference on `client`; a client no longer pooled for the key has none left to give back. */
  releaseClient(root: string, server: ClientIdentity, client?: LspClient): void {
    const managed = this.clients.get(lspClientKey(root, server))
    if (client !== undefined && managed?.client !== client) return
    if (managed && managed.refCount > 0) {
      managed.refCount--
      managed.lastUsedAt = this.now()
    }
  }

  invalidateClient(root: string, server: ClientIdentity, client?: LspClient): void {
    const managed = this.clients.get(lspClientKey(root, server))
    if (!managed) return
    if (client && managed.client !== client) return
    this.discard(managed)
  }

  warmupClient(root: string, server: ResolvedServer): void {
    if (this.disposed) return
    const key = lspClientKey(root, server)
    if (this.clients.has(key) || this.pendingStops.has(key)) return

    this.evictForAdmission()
    try {
      this.ensureRespawnAllowed(key, root, server.id)
    } catch {
      return
    }
    this.startClient(key, root, server, false)
  }

  isServerInitializing(root: string, server: ClientIdentity): boolean {
    const managed = this.clients.get(lspClientKey(root, server))
    return managed?.isInitializing ?? false
  }

  getSnapshot(): ClientSnapshot[] {
    const snapshots: ClientSnapshot[] = []
    for (const managed of this.clients.values()) {
      snapshots.push({
        root: managed.root,
        serverId: managed.serverId,
        refCount: managed.refCount,
        pendingWaiters: managed.pendingWaiters,
        lastUsedAt: managed.lastUsedAt,
        isInitializing: managed.isInitializing,
        alive: managed.client.isAlive(),
        command: managed.client.command(),
      })
    }
    return snapshots
  }

  hasClient(root: string, server: ClientIdentity): boolean {
    return this.clients.has(lspClientKey(root, server))
  }

  clientCount(): number {
    return this.clients.size
  }

  async stopAll(): Promise<void> {
    this.disposed = true

    this.stopReaper()

    if (this.signalDisposer) {
      this.signalDisposer()
      this.signalDisposer = null
    }

    const stopPromises: Promise<void>[] = []
    for (const managed of this.clients.values()) {
      stopPromises.push(stopClientBestEffort(managed.client))
    }
    const tombstonedStops = [...this.pendingStops.values()]
    this.clients.clear()
    this.respawnBudgets.clear()
    await Promise.allSettled([...stopPromises, ...tombstonedStops])
    this.pendingStops.clear()
  }
}

let _defaultInstance: LspManager | null = null

export function getLspManager(): LspManager {
  if (!_defaultInstance) {
    _defaultInstance = new LspManager()
  }
  return _defaultInstance
}

export async function disposeDefaultLspManager(): Promise<void> {
  if (_defaultInstance) {
    const m = _defaultInstance
    _defaultInstance = null
    await m.stopAll()
  }
}
