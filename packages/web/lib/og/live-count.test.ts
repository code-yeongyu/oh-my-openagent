/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createOgCountSource } from "./live-count"
import { edgeCountStore, type CountSnapshot, type SharedCountStore } from "./shared-count-store"

const FRESH_MS = 300_000
const MAX_STALE_MS = 86_400_000

let now = 1_800_000_000_000
let shared: Map<string, CountSnapshot>
let writes: { readonly key: string; readonly snapshot: CountSnapshot; readonly ttl: number }[]

const memoryStore: SharedCountStore = {
  read: async (key) => shared.get(key) ?? null,
  write: async (key, snapshot, ttl) => {
    writes.push({ key, snapshot, ttl })
    shared.set(key, snapshot)
  },
}

function source(load: () => Promise<number>, store: SharedCountStore = memoryStore) {
  return createOgCountSource({
    key: "figure",
    label: "figure",
    freshMs: FRESH_MS,
    maxStaleMs: MAX_STALE_MS,
    load,
    store,
  })
}

function failing(): Promise<number> {
  return Promise.reject(new Error("upstream down"))
}

beforeEach(() => {
  now = 1_800_000_000_000
  shared = new Map()
  writes = []
  spyOn(Date, "now").mockImplementation(() => now)
  spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  mock.restore()
})

describe("a cold isolate", () => {
  test("adopts a fresh shared figure without calling upstream", async () => {
    // Given: another isolate stored a figure 100 seconds ago.
    shared.set("figure", { count: 4_032_665, timestamp: now - 100_000 })
    const load = mock(failing)

    // When: this isolate serves its first request.
    const result = await source(load).get()

    // Then: the shared figure is live until its original expiry, and upstream is untouched.
    expect(result).toEqual({ count: 4_032_665, source: "live", expiresAt: now + 200_000 })
    expect(load).not.toHaveBeenCalled()
  })

  test("falls back to the shared figure when every attempt fails", async () => {
    shared.set("figure", { count: 69_357, timestamp: now - 3_600_000 })
    const load = mock(failing)

    expect(await source(load).get()).toEqual({ count: 69_357, source: "stale" })
    expect(load).toHaveBeenCalledTimes(2)
  })

  test("withholds a shared figure older than one day", async () => {
    shared.set("figure", { count: 69_357, timestamp: now - MAX_STALE_MS - 1 })
    expect(await source(failing).get()).toEqual({ count: null, source: "unavailable" })
  })
})

describe("refresh", () => {
  test("retries once after a transient failure", async () => {
    // Given: the first upstream call fails and the second succeeds.
    let calls = 0
    const load = mock(async () => {
      calls += 1
      if (calls === 1) throw new Error("reset")
      return 70_000
    })

    // When / Then: the figure is live and upstream was called exactly twice.
    expect(await source(load).get()).toEqual({
      count: 70_000,
      source: "live",
      expiresAt: now + FRESH_MS,
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  test("shares every new figure for the stale window", async () => {
    await source(async () => 42).get()
    expect(writes).toEqual([
      { key: "figure", snapshot: { count: 42, timestamp: now }, ttl: 86_400 },
    ])
  })

  test("keeps the newer of the isolate and shared figures", async () => {
    const figure = source(async () => 1)
    await figure.get()
    const newer = now + 10
    shared.set("figure", { count: 2, timestamp: newer })
    now += FRESH_MS
    expect(await figure.get()).toEqual({ count: 2, source: "live", expiresAt: newer + FRESH_MS })
  })

  test("a failing shared store never breaks rendering", async () => {
    const broken: SharedCountStore = {
      read: () => Promise.reject(new Error("cache read")),
      write: () => Promise.reject(new Error("cache write")),
    }
    expect(await source(async () => 7, broken).get()).toEqual({
      count: 7,
      source: "live",
      expiresAt: now + FRESH_MS,
    })
  })
})

describe("edgeCountStore", () => {
  const originalCaches: unknown = Reflect.get(globalThis, "caches")

  afterEach(() => {
    Reflect.set(globalThis, "caches", originalCaches)
  })

  test("is a no-op outside Workers", async () => {
    Reflect.set(globalThis, "caches", undefined)
    await edgeCountStore.write("stars", { count: 1, timestamp: 2 }, 60)
    expect(await edgeCountStore.read("stars")).toBeNull()
  })

  test("round-trips a snapshot through the Workers cache and rejects bad payloads", async () => {
    // Given: a Workers-like default cache.
    const entries = new Map<string, Response>()
    const puts: { readonly url: string; readonly cacheControl: string | null }[] = []
    Reflect.set(globalThis, "caches", {
      default: {
        match: async (request: Request) => entries.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => {
          puts.push({ url: request.url, cacheControl: response.headers.get("cache-control") })
          entries.set(request.url, response)
        },
      },
    })

    // When: a snapshot is written and read back, and a corrupt entry is read.
    await edgeCountStore.write("npm-downloads", { count: 4_032_665, timestamp: 5 }, 86_400)
    const roundTrip = await edgeCountStore.read("npm-downloads")
    entries.set(
      "https://omo.dev/__og-count/github-stars",
      Response.json({ count: -1, timestamp: 5 }),
    )

    // Then: the value survives with the stale-window TTL, and corrupt data is ignored.
    expect(roundTrip).toEqual({ count: 4_032_665, timestamp: 5 })
    expect(puts).toEqual([
      { url: "https://omo.dev/__og-count/npm-downloads", cacheControl: "public, max-age=86400" },
    ])
    expect(await edgeCountStore.read("github-stars")).toBeNull()
  })
})
