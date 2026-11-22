import type { LspClient } from "./client.js"

/**
 * Lifecycle of a starting client, owned by the LspManager.
 *
 * The manager owns every startup and every shutdown; a caller only waits. A startup begun by getClient
 * is held by its waiters, counted in `pendingWaiters` from the moment they join until each one either
 * becomes a reference or leaves. A waiter whose signal aborts (a caller cancellation or a directory
 * scan's start deadline) detaches: it stops counting and rejects at once, and never awaits a shutdown.
 * When the last waiter of a waiter-held startup leaves while it holds no reference, the manager drops
 * the startup from its pool (so `clientCount()` no longer counts it) and stops it as a tracked
 * tombstone, which the next getClient for that key and `stopAll()` await, so no process outlives the
 * manager. A start that fails is dropped and stopped the same way, once. A warmup startup has no waiter
 * to lose and runs to its end.
 *
 * States of one key: ABSENT; STARTING (N counted waiters); RESIDENT (R references, plus the counted
 * waiters of a start that just finished); STOPPING (not pooled, stop tracked in `pendingStops`).
 * - getClient resident hit: R+1 synchronously, no await.
 * - getClient cold start or joining a start: counted (N+1) synchronously, then awaits the start. When it
 *   resumes it stops counting and takes its reference (R+1) in one synchronous step, after checking it
 *   still holds the pooled instance for its key and that the client is alive. A client that is no longer
 *   pooled (stopped by the init-timeout reaper, invalidateClient or stopAll while it waited) is never
 *   handed out: the caller acquires again through the normal path, which awaits that stop and starts a
 *   fresh client, or rejects once the manager is disposed.
 * - Waiter abort or deadline: N-1, rejects; the last waiter leaving stops the startup as above.
 * - releaseClient: R-1 on the instance the caller held; a stale instance gives back nothing.
 * - Eviction at the resident cap and the idle reaper take only a RESIDENT client with R = 0 and N = 0.
 * - The init-timeout reaper stops a startup older than the init timeout whatever its waiters, and
 *   stopAll stops everything; neither hands the stopped client to a caller.
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

  /**
   * Waits for the start as one counted waiter. A rejection has already detached the waiter; a
   * resolution leaves it counted, and the caller must turn it into a reference or `detach` it before
   * its next await.
   */
  async wait(managed: ManagedClient, initPromise: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
    managed.pendingWaiters++
    try {
      await awaitWithSignal(initPromise, signal)
    } catch (error) {
      this.detach(managed)
      throw error
    }
  }

  detach(managed: ManagedClient): void {
    managed.pendingWaiters--
    if (managed.pendingWaiters === 0 && managed.refCount === 0 && managed.heldByWaiters) this.discard(managed)
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
