/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { formatOgStars, getOgStars, resetOgStarsCacheForTests } from "./stars"

let now = 1_800_000_000_000
let reply: () => Promise<Response>
const requests: string[] = []

beforeEach(() => {
  resetOgStarsCacheForTests()
  now = 1_800_000_000_000
  requests.length = 0
  reply = async () => Response.json({ stargazers_count: 69_999 })
  spyOn(Date, "now").mockImplementation(() => now)
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push(String(input))
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(init?.cache).toBe("no-store")
        return reply()
      },
      { preconnect: fetch.preconnect },
    ),
  )
})

afterEach(() => {
  mock.restore()
  resetOgStarsCacheForTests()
})

describe("OG star formatting", () => {
  test.each([
    [null, "GitHub"],
    [0, "0 Stars"],
    [999, "999 Stars"],
    [1_000, "1K+ Stars"],
    [69_999, "69K+ Stars"],
    [100_000, "100K+ Stars"],
  ])("formats %s without rounding up", (count, label) => {
    expect(formatOgStars(count)).toBe(label)
  })
})

describe("OG GitHub retrieval", () => {
  test("requests only GitHub and reuses fresh data", async () => {
    await getOgStars()
    const result = await getOgStars()
    expect(result).toEqual({ count: 69_999, source: "live", expiresAt: now + 300_000 })
    expect(requests).toEqual(["https://api.github.com/repos/code-yeongyu/oh-my-openagent"])
  })

  test("refreshes at the five-minute boundary", async () => {
    await getOgStars()
    now += 300_000
    reply = async () => Response.json({ stargazers_count: 70_001 })
    expect(await getOgStars()).toEqual({
      count: 70_001,
      source: "live",
      expiresAt: now + 300_000,
    })
    expect(requests).toHaveLength(2)
  })

  test("coalesces concurrent requests", async () => {
    const result = await Promise.all([getOgStars(), getOgStars(), getOgStars()])
    expect(result.map((item) => item.count)).toEqual([69_999, 69_999, 69_999])
    expect(requests).toHaveLength(1)
  })

  test("serves last known good on an expired-cache refresh failure", async () => {
    await getOgStars()
    now += 300_000
    reply = async () => new Response("Rate limited", { status: 403 })
    expect(await getOgStars()).toEqual({ count: 69_999, source: "stale" })
  })

  test("does not present a count older than one day", async () => {
    await getOgStars()
    now += 86_400_001
    reply = async () => new Response("Unavailable", { status: 503 })
    expect(await getOgStars()).toEqual({ count: null, source: "unavailable" })
  })

  test.each([null, {}, { stargazers_count: -1 }, { stargazers_count: 1.5 }])(
    "rejects invalid GitHub data %j",
    async (payload) => {
      reply = async () => Response.json(payload)
      expect(await getOgStars()).toEqual({ count: null, source: "unavailable" })
    },
  )

  test("recovers immediately after a cold network failure", async () => {
    reply = async () => {
      throw new TypeError("Network unavailable")
    }
    expect(await getOgStars()).toEqual({ count: null, source: "unavailable" })
    reply = async () => Response.json({ stargazers_count: 70_123 })
    expect(await getOgStars()).toEqual({
      count: 70_123,
      source: "live",
      expiresAt: now + 300_000,
    })
  })
})
