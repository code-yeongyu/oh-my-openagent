export interface CountSnapshot {
  readonly count: number
  readonly timestamp: number
}

export interface SharedCountStore {
  readonly read: (key: string) => Promise<CountSnapshot | null>
  readonly write: (key: string, snapshot: CountSnapshot, ttlSeconds: number) => Promise<void>
}

interface EdgeCache {
  readonly match: (request: Request) => Promise<Response | undefined>
  readonly put: (request: Request, response: Response) => Promise<void>
}

function isEdgeCache(value: unknown): value is EdgeCache {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "match") === "function" &&
    typeof Reflect.get(value, "put") === "function"
  )
}

function edgeCache(): EdgeCache | null {
  const storage: unknown = Reflect.get(globalThis, "caches")
  const cache: unknown =
    typeof storage === "object" && storage !== null ? Reflect.get(storage, "default") : undefined
  return isEdgeCache(cache) ? cache : null
}

function parseSnapshot(payload: unknown): CountSnapshot | null {
  if (typeof payload !== "object" || payload === null) return null
  const count: unknown = Reflect.get(payload, "count")
  const timestamp: unknown = Reflect.get(payload, "timestamp")
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null
  return { count, timestamp }
}

const keyRequest = (key: string) => new Request(`https://omo.dev/__og-count/${key}`)

// Cloudflare's per-colo Cache API lets a freshly started isolate reuse the last good figure
// another isolate fetched. Outside Workers (tests, local dev) there is no cache and it no-ops.
export const edgeCountStore: SharedCountStore = {
  async read(key) {
    const cache = edgeCache()
    if (!cache) return null
    const response = await cache.match(keyRequest(key))
    return response ? parseSnapshot(await response.json()) : null
  },
  async write(key, snapshot, ttlSeconds) {
    const cache = edgeCache()
    if (!cache) return
    await cache.put(
      keyRequest(key),
      Response.json(snapshot, { headers: { "Cache-Control": `public, max-age=${ttlSeconds}` } }),
    )
  },
}
