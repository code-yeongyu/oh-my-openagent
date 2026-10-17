import { edgeCountStore, type CountSnapshot, type SharedCountStore } from "./shared-count-store"

export type OgCount =
  | { readonly count: number; readonly source: "live"; readonly expiresAt: number }
  | { readonly count: number; readonly source: "stale" }
  | { readonly count: null; readonly source: "unavailable" }

export interface OgCountSource {
  readonly get: () => Promise<OgCount>
  readonly reset: () => void
}

const LOAD_ATTEMPTS = 2

/**
 * A bounded, coalesced cache for one live social-image figure. The last good value is kept
 * in the isolate and in a colo-shared store, so a cold isolate can still render it; failures
 * are never cached, stale values are served for at most `maxStaleMs`, then the figure is withheld.
 */
export function createOgCountSource(options: {
  readonly key: string
  readonly label: string
  readonly freshMs: number
  readonly maxStaleMs: number
  readonly load: () => Promise<number>
  readonly store?: SharedCountStore
}): OgCountSource {
  const store = options.store ?? edgeCountStore
  let cache: CountSnapshot | null = null
  let pending: Promise<OgCount> | null = null

  const isFresh = (snapshot: CountSnapshot) => Date.now() - snapshot.timestamp < options.freshMs
  const live = (snapshot: CountSnapshot): OgCount => ({
    count: snapshot.count,
    source: "live",
    expiresAt: snapshot.timestamp + options.freshMs,
  })

  async function adoptShared(): Promise<void> {
    try {
      const shared = await store.read(options.key)
      if (shared && (!cache || shared.timestamp > cache.timestamp)) cache = shared
    } catch (error) {
      console.warn(`Unable to read shared OG ${options.label}`, error)
    }
  }

  async function loadWithRetry(): Promise<number> {
    let lastError: unknown
    for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
      try {
        return await options.load()
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }

  async function resolve(): Promise<OgCount> {
    await adoptShared()
    if (cache && isFresh(cache)) return live(cache)
    try {
      const snapshot = { count: await loadWithRetry(), timestamp: Date.now() }
      cache = snapshot
      try {
        await store.write(options.key, snapshot, Math.floor(options.maxStaleMs / 1_000))
      } catch (error) {
        console.warn(`Unable to share OG ${options.label}`, error)
      }
      return live(snapshot)
    } catch (error) {
      console.warn(`Unable to refresh OG ${options.label}`, error)
      if (cache && Date.now() - cache.timestamp <= options.maxStaleMs) {
        return { count: cache.count, source: "stale" }
      }
      return { count: null, source: "unavailable" }
    }
  }

  return {
    async get() {
      if (cache && isFresh(cache)) return live(cache)
      if (pending) return pending
      pending = resolve()
      try {
        return await pending
      } finally {
        pending = null
      }
    },
    reset() {
      cache = null
      pending = null
    },
  }
}
