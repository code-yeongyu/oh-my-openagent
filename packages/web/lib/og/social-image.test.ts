/// <reference types="bun" />
import { afterEach, expect, mock, spyOn, test } from "bun:test"
import OpenGraphImage from "../../app/opengraph-image"
import { resetStatsCacheForTests } from "../stats"
import { resetOgStarsCacheForTests } from "./stars"

afterEach(() => {
  mock.restore()
  resetStatsCacheForTests()
  resetOgStarsCacheForTests()
})

test("GitHub star updates change the rendered PNG even when npm is unavailable", async () => {
  // Given: only GitHub is healthy, and the clock crosses the refresh window.
  let count = 12_345
  let now = 1_800_000_000_000
  spyOn(Date, "now").mockImplementation(() => now)
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) => {
        const url = String(input)
        return url.startsWith("https://api.github.com/repos/")
          ? Response.json({ stargazers_count: count, description: "OmO" })
          : new Response("Unavailable", { status: 503 })
      },
      { preconnect: fetch.preconnect },
    ),
  )
  resetStatsCacheForTests()
  resetOgStarsCacheForTests()

  // When: a new GitHub count is rendered after cache expiry.
  const first = await (await OpenGraphImage()).arrayBuffer()
  count = 98_765
  now += 301_000
  const second = await (await OpenGraphImage()).arrayBuffer()

  // Then: both are PNGs and the actual image reflects the changed count.
  expect([...new Uint8Array(first).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect([...new Uint8Array(second).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(Bun.hash(first)).not.toBe(Bun.hash(second))
})

test("a degraded image is not cached and contains no fabricated star count", async () => {
  // Given: GitHub is unavailable on a cold renderer.
  resetOgStarsCacheForTests()
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => new Response("Unavailable", { status: 503 }), {
      preconnect: fetch.preconnect,
    }),
  )

  // When: a crawler requests the image.
  const response = await OpenGraphImage()
  const png = await response.arrayBuffer()

  // Then: the brand still renders, without caching an invented number.
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("x-og-stars")).toBe("unavailable")
  expect(response.headers.get("x-og-stars-source")).toBe("unavailable")
  expect(new DataView(png).getUint32(16)).toBe(1200)
  expect(new DataView(png).getUint32(20)).toBe(630)
})

test("downstream caches cannot extend the original five-minute freshness window", async () => {
  // Given: a count fetched 299 seconds ago is still in the worker cache.
  resetOgStarsCacheForTests()
  let now = 1_800_000_000_000
  spyOn(Date, "now").mockImplementation(() => now)
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async () => Response.json({ stargazers_count: 69_999 }), {
      preconnect: fetch.preconnect,
    }),
  )
  await (await OpenGraphImage()).arrayBuffer()
  now += 299_000

  // When: another crawler receives the same cached count.
  const response = await OpenGraphImage()
  await response.arrayBuffer()

  // Then: the response can be cached for only the remaining second.
  expect(response.headers.get("cache-control")).toBe(
    "public, max-age=0, s-maxage=1, must-revalidate",
  )
})
