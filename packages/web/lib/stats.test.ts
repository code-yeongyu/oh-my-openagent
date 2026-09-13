/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { getStats, resetStatsCacheForTests } from "./stats"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const GITHUB = /api\.github\.com\/repos\//
const NPM_POINT = /api\.npmjs\.org\/downloads\/point\/([^/]+)\/([^/?]+)/

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

interface NpmScript {
  readonly onPoint: (period: string, pkg: string, call: number) => number | Response
}

function installFetch(script: NpmScript): { calls: () => readonly string[] } {
  const seen: string[] = []
  let count = 0
  const fake: FetchLike = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    seen.push(url)
    if (GITHUB.test(url)) {
      return json({ stargazers_count: 69_000, description: "OmO" })
    }
    const match = NPM_POINT.exec(url)
    if (!match) throw new Error(`unexpected fetch ${url}`)
    const period = match[1] ?? ""
    const pkg = match[2] ?? ""
    count += 1
    const out = script.onPoint(period, pkg, count)
    return out instanceof Response ? out : json({ downloads: out, package: pkg })
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
    expect(calls().some((url) => /\/omo-ai(\?|$)/.test(url))).toBe(true)
  })
})
