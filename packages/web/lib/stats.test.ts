/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { FALLBACK_STATS_DATA, formatStats, getStats, resetStatsCacheForTests } from "./stats"

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
})

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
