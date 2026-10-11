/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  FALLBACK_STATS_DATA,
  formatStats,
  getStats,
  resetStatsCacheForTests,
  setStatsStoreForTests,
  type StatsStore,
} from "./stats"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const GITHUB = /api\.github\.com\/repos\//
const RELEASES_PAGE =
  /api\.github\.com\/repos\/code-yeongyu\/oh-my-openagent\/releases\?per_page=30&page=(\d+)$/
const NPM_POINT = /api\.npmjs\.org\/downloads\/point\/([^/]+)\/([^/?]+)/

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

interface NpmScript {
  readonly onPoint: (period: string, pkg: string, call: number) => number | Response
  readonly onReleasesPage?: (page: number) => unknown
  readonly onInstallerStats?: () => unknown
}

function installFetch(script: NpmScript): { calls: () => readonly string[] } {
  const seen: string[] = []
  let count = 0
  const fake: FetchLike = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    seen.push(url)
    const releasesPage = RELEASES_PAGE.exec(url)
    if (releasesPage) {
      const out = script.onReleasesPage?.(Number(releasesPage[1])) ?? []
      return out instanceof Response ? out : json(out)
    }
    if (url === "https://get.omo.dev/stats/downloads") {
      const out = script.onInstallerStats?.() ?? { uncountedByGitHub: 0 }
      return out instanceof Response ? out : json(out)
    }
    if (GITHUB.test(url)) {
      return json({ stargazers_count: 69_000, description: "OmO" })
    }
    const match = NPM_POINT.exec(url)
    if (!match) throw new Error(`unexpected fetch ${url}`)
    const period = match[1] ?? ""
    const body: Record<string, unknown> = {}
    for (const pkg of (match[2] ?? "").split(",")) {
      count += 1
      const out = script.onPoint(period, pkg, count)
      if (out instanceof Response) return out
      body[pkg] = { downloads: out, package: pkg }
    }
    return json(body)
  }
  globalThis.fetch = fake as unknown as typeof fetch
  return { calls: () => seen }
}

const realFetch = globalThis.fetch

beforeEach(() => {
  resetStatsCacheForTests()
})

afterEach(() => {
  globalThis.fetch = realFetch
  resetStatsCacheForTests()
  setStatsStoreForTests(undefined)
})

function memoryStore(): StatsStore & { entries: () => number } {
  let saved: Parameters<StatsStore["write"]>[0] | null = null
  let writes = 0
  return {
    read: async () => saved,
    write: async (entry) => {
      saved = entry
      writes += 1
    },
    entries: () => writes,
  }
}

describe("getStats aggregation is all-or-nothing", () => {
  test("one failing npm sub-request rejects and does not cache a partial sum", async () => {
    let failOnce = true
    installFetch({
      onPoint: (_period, pkg) => {
        if (failOnce && pkg === "oh-my-openagent") {
          failOnce = false
          return json({ error: "upstream" }, 500)
        }
        return 100
      },
    })

    await expect(getStats()).rejects.toThrow()

    // Every request now succeeds; a poisoned cache would still return the partial aggregate (100).
    installFetch({ onPoint: () => 100 })
    const stats = await getStats()
    expect(stats.monthlyDownloads).toBeGreaterThanOrEqual(200)
  })

  test("a thrown fetch rejects instead of silently retrying the same range", async () => {
    let thrown = false
    const { calls } = installFetch({
      onPoint: (period) => {
        if (!thrown && /^\d{4}-/.test(period)) {
          thrown = true
          throw new TypeError("network down")
        }
        return 10
      },
    })

    await expect(getStats()).rejects.toThrow()
    // Bounded: the loop must not re-request the same year forever.
    expect(calls().length).toBeLessThan(40)
  })

  test("omo-ai is part of the download aggregate", async () => {
    const { calls } = installFetch({ onPoint: () => 1 })
    await getStats()
    expect(calls().some((url) => /[/,]omo-ai(,|$)/.test(url))).toBe(true)
  })

  test("the Codex edition lazycodex-ai is part of the download aggregate", async () => {
    installFetch({ onPoint: (_period, pkg) => (pkg === "lazycodex-ai" ? 1_000 : 0) })
    const stats = await getStats()
    expect(stats.weeklyDownloads).toBe(1_000)
    expect(stats.monthlyDownloads).toBe(1_000)
  })
})

function release(...assets: readonly (readonly [string, number])[]) {
  return { assets: assets.map(([name, download_count]) => ({ name, download_count })) }
}

describe("compiled binary downloads from GitHub releases", () => {
  test("only omo-* binaries on every page are added to the total, never to the npm figure", async () => {
    const { calls } = installFetch({
      onPoint: () => 1,
      onReleasesPage: (page) =>
        page === 1
          ? Array.from({ length: 30 }, () =>
              release(
                ["omo-linux-x64", 1],
                ["SHA256SUMS", 50],
                ["senpi-desktop-engine-darwin-arm64", 7],
              ),
            )
          : [release(["omo-windows-x64-baseline.exe", 5])],
    })

    const stats = await getStats()

    expect(stats.nativeDownloads).toBe(35)
    expect(stats.totalDownloads).toBe(stats.npmTotalDownloads + 35)
    expect(calls().filter((url) => RELEASES_PAGE.test(url))).toHaveLength(2)
  })

  test("installs served by the get.omo.dev mirror join the total once, GitHub redirects do not", async () => {
    installFetch({
      onPoint: () => 100,
      onReleasesPage: (page) =>
        page === 1 ? [{ assets: [{ name: "omo-linux-x64", download_count: 50 }] }] : [],
      onInstallerStats: () => ({ uncountedByGitHub: 7, redirectedToGitHub: 30 }),
    })

    const stats = await getStats()

    expect(stats.installerDownloads).toBe(7)
    expect(stats.totalDownloads).toBe(stats.npmTotalDownloads + 50 + 7)
  })

  test("a malformed get.omo.dev stats reply rejects the refresh instead of counting zero", async () => {
    installFetch({ onPoint: () => 100, onInstallerStats: () => ({ uncountedByGitHub: -3 }) })

    await expect(getStats()).rejects.toThrow("uncountedByGitHub")
  })

  test("the walk stops at the first page of releases that predate the compiled binaries", async () => {
    const { calls } = installFetch({
      onPoint: () => 1,
      onReleasesPage: (page) =>
        page === 1
          ? Array.from({ length: 30 }, () => release(["omo-darwin-arm64", 2]))
          : Array.from({ length: 30 }, () => release(["oh-my-opencode-darwin-arm64.tgz", 9])),
    })

    const stats = await getStats()

    expect(stats.nativeDownloads).toBe(60)
    expect(calls().filter((url) => RELEASES_PAGE.test(url))).toHaveLength(2)
  })

  test("a release page without download counts rejects instead of counting it as zero", async () => {
    installFetch({
      onPoint: () => 1,
      onReleasesPage: () => [{ assets: [{ name: "omo-linux-x64" }] }],
    })

    await expect(getStats()).rejects.toThrow()
  })

  test("a failing release page rejects the refresh like a failing npm range", async () => {
    installFetch({ onPoint: () => 1, onReleasesPage: () => json({ message: "rate limited" }, 403) })

    await expect(getStats()).rejects.toThrow()
  })
})

describe("formatStats", () => {
  test.each([
    [3_894_680, "3.8M+"],
    [4_032_665, "4M+"],
    [1_000_000, "1M+"],
  ])("floors %d to %s so the plus sign is true", (totalDownloads, label) => {
    expect(formatStats({ ...FALLBACK_STATS_DATA, totalDownloads }).totalDownloads).toBe(label)
  })
})

describe("shared last-known-good copy (#9820)", () => {
  test("a cold isolate whose refresh fails serves the last full aggregate another isolate stored", async () => {
    const store = memoryStore()
    setStatsStoreForTests(store)
    installFetch({ onPoint: () => 100 })
    const good = await getStats()
    expect(store.entries()).toBe(1)

    resetStatsCacheForTests() // a new isolate: no in-memory cache
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    expect(await getStats()).toEqual(good)
  })

  test("a cold isolate inherits the stored copy's age, so an old copy is refreshed on the next request", async () => {
    const store = memoryStore()
    const old = { ...FALLBACK_STATS_DATA, stars: 70_000 }
    await store.write({ data: old, timestamp: Date.now() - 2 * 60 * 60 * 1000 })
    setStatsStoreForTests(store)
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    expect((await getStats()).stars).toBe(70_000)
    // Upstreams recover: the 2-hour-old copy is past the in-memory TTL, so the next request refreshes at once
    // (a copy re-stamped "now" would be held for another hour instead).
    const { calls } = installFetch({ onPoint: () => 100 })
    await getStats()
    expect(calls().length).toBeGreaterThan(0)
  })

  test("a failed refresh never writes the shared copy, so a partial aggregate is never stored", async () => {
    const store = memoryStore()
    setStatsStoreForTests(store)
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    await expect(getStats()).rejects.toThrow()
    expect(store.entries()).toBe(0)
  })

  test("with nothing ever stored, a cold failure still rejects (callers render the fallback)", async () => {
    setStatsStoreForTests(memoryStore())
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    await expect(getStats()).rejects.toThrow()
  })

  test("a store that throws on read or write never breaks the page", async () => {
    setStatsStoreForTests({
      read: async () => {
        throw new Error("cache down")
      },
      write: async () => {
        throw new Error("cache down")
      },
    })
    installFetch({ onPoint: () => 100 })
    const good = await getStats()
    expect(good.monthlyDownloads).toBeGreaterThan(0)
    resetStatsCacheForTests()
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    // The caller sees the upstream failure, not the cache's.
    const failure = await getStats().then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).not.toContain("cache down")
  })
})

describe("the Cache API store (#9820)", () => {
  const fakeCaches = () => {
    const kept = new Map<string, Response>()
    const cacheDefault = {
      match: async (key: string) => kept.get(key)?.clone() ?? undefined,
      put: async (key: string, res: Response) => {
        kept.set(key, res.clone())
      },
    }
    return { kept, install: () => Object.assign(globalThis, { caches: { default: cacheDefault } }) }
  }
  const realCaches = (globalThis as { caches?: unknown }).caches
  afterEach(() => {
    Object.assign(globalThis, { caches: realCaches })
  })

  test("round-trips through caches.default under one key, with a week-long max-age", async () => {
    const fake = fakeCaches()
    fake.install()
    installFetch({ onPoint: () => 100 })
    const good = await getStats()
    expect([...fake.kept.keys()]).toEqual(["https://omo.dev/__stats/last-known-good/v1"])
    expect(
      fake.kept.get("https://omo.dev/__stats/last-known-good/v1")?.headers.get("cache-control"),
    ).toBe("public, max-age=604800")
    resetStatsCacheForTests()
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    expect(await getStats()).toEqual(good)
  })

  test("malformed stored entries are ignored: bad counts, a non-string description, a non-number time", async () => {
    const good = { ...FALLBACK_STATS_DATA, stars: 70_000 }
    for (const entry of [
      { data: { ...good, stars: -1 }, timestamp: 1 },
      { data: { ...good, monthlyDownloads: Number.POSITIVE_INFINITY }, timestamp: 1 },
      { data: { ...good, description: 7 }, timestamp: 1 },
      { data: good, timestamp: "yesterday" },
    ]) {
      resetStatsCacheForTests()
      const fake = fakeCaches()
      fake.install()
      fake.kept.set(
        "https://omo.dev/__stats/last-known-good/v1",
        new Response(JSON.stringify(entry)),
      )
      installFetch({
        onPoint: (_period, pkg) =>
          pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
      })
      await expect(getStats()).rejects.toThrow()
    }
  })

  test("a malformed stored entry is ignored, so the cold failure rejects", async () => {
    const fake = fakeCaches()
    fake.install()
    fake.kept.set(
      "https://omo.dev/__stats/last-known-good/v1",
      new Response(JSON.stringify({ data: { stars: "lots" }, timestamp: 1 })),
    )
    installFetch({
      onPoint: (_period, pkg) =>
        pkg === "oh-my-openagent" ? json({ error: "upstream" }, 500) : 100,
    })
    await expect(getStats()).rejects.toThrow()
  })
})
