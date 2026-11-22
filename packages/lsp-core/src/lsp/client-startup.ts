import type { LspClient } from "./client.js"

/**
 * Lifecycle of a starting client, owned by the LspManager.
 *
 * The manager owns every startup and every shutdown; a caller only waits. A startup begun by getClient
 * is held by its waiters, counted in `pendingWaiters` while they await the start. A waiter whose signal
 * aborts (a caller cancellation or a directory scan's start deadline) detaches: it stops counting and
 * rejects at once, and never awaits a shutdown. When the last waiter detaches while the start is still
 * running, the manager drops the startup from its pool (so `clientCount()` no longer counts it) and
 * stops it as a tracked tombstone, which the next getClient for that key and `stopAll()` await, so no
 * process outlives the manager. A start that fails is dropped and stopped the same way, once. A waiter
 * that sees the start finish on a live client takes one reference (`refCount`) and gives it back with
 * releaseClient. A warmup startup has no waiter to lose and runs to its end. The reaper still stops any
 * startup older than the init timeout, whatever its waiters, and any idle client with no reference and
 * no waiter.
 */
export interface ManagedClient {
  readonly key: string
  readonly root: string
  readonly serverId: string
  readonly client: LspClient
  /** False for a warmup startup, which no waiter holds. */
  readonly heldByWaiters: boolean
  refCount: number
  pendingWaiters: number
  lastUsedAt: number
  initPromise: Promise<void> | null
  isInitializing: boolean
  initializingSince: number | null
}

export interface StartupRequest {
  readonly key: string
  readonly root: string
  readonly serverId: string
  readonly client: LspClient
  readonly heldByWaiters: boolean
}

export class ClientStartups {
  constructor(
    private readonly now: () => number,
    private readonly discard: (managed: ManagedClient) => void,
  ) {}

  begin(request: StartupRequest): ManagedClient {
    const { client } = request
    const startedAt = this.now()
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()
    const managed: ManagedClient = {
      ...request,
      refCount: 0,
      pendingWaiters: 0,
      lastUsedAt: startedAt,
      initPromise,
      isInitializing: true,
      initializingSince: startedAt,
    }
    // Registered before any waiter, so the pool reflects the outcome by the time a waiter resumes.
    initPromise.then(
      () => {
        managed.isInitializing = false
        managed.initializingSince = null
        managed.initPromise = null
        managed.lastUsedAt = this.now()
      },
      () => this.discard(managed),
    )
    return managed
  }

  async wait(managed: ManagedClient, signal: AbortSignal | undefined): Promise<void> {
    if (managed.initPromise === null) return
    managed.pendingWaiters++
    try {
      await awaitWithSignal(managed.initPromise, signal)
    } catch (error) {
      managed.pendingWaiters--
      if (managed.pendingWaiters === 0 && managed.isInitializing && managed.heldByWaiters) this.discard(managed)
      throw error
    }
    managed.pendingWaiters--
  }
}

export function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(new DOMException("Aborted", "AbortError"))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", onAbort)
        reject(err)
      },
    )
  })
}
