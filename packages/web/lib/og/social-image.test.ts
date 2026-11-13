/// <reference types="bun" />
import { afterEach, expect, mock, spyOn, test } from "bun:test"
import OpenGraphImage from "../../app/opengraph-image"
import { resetStatsCacheForTests } from "../stats"
import { resetOgDownloadsCacheForTests } from "./downloads"
import { resetOgStarsCacheForTests } from "./stars"

function upstream(url: string, stars: number, downloadsPerPackage: number): Response {
  if (url === "https://get.omo.dev/stats/downloads") {
    return Response.json({ uncountedByGitHub: downloadsPerPackage })
  }
  if (url.includes("/releases?")) {
    return Response.json([
      { assets: [{ name: "omo-linux-x64", download_count: downloadsPerPackage }] },
    ])
  }
  if (url.startsWith("https://api.github.com/repos/")) {
    return Response.json({ stargazers_count: stars })
  }
  const packages = url.split("/").at(-1)?.split(",") ?? []
  return Response.json(
    Object.fromEntries(
      packages.map((pkg) => [pkg, { downloads: downloadsPerPackage, package: pkg }]),
    ),
  )
}

afterEach(() => {
  mock.restore()
  resetStatsCacheForTests()
  resetOgStarsCacheForTests()
  resetOgDownloadsCacheForTests()
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
  resetOgDownloadsCacheForTests()
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async (input: RequestInfo | URL) => upstream(String(input), 69_999, 1_000), {
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

test("an npm outage keeps live stars, withholds downloads and is not cached", async () => {
  // Given: GitHub is healthy and npm is down on a cold renderer.
  resetOgStarsCacheForTests()
  resetOgDownloadsCacheForTests()
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL) =>
        String(input).startsWith("https://api.github.com/repos/")
          ? Response.json({ stargazers_count: 69_355 })
          : new Response("Unavailable", { status: 503 }),
      { preconnect: fetch.preconnect },
    ),
  )

  // When: a crawler requests the image.
  const response = await OpenGraphImage()
  await response.arrayBuffer()

  // Then: stars stay live, downloads are withheld rather than invented, nothing is cached.
  expect(response.headers.get("x-og-stars")).toBe("69355")
  expect(response.headers.get("x-og-stars-source")).toBe("live")
  expect(response.headers.get("x-og-downloads")).toBe("unavailable")
  expect(response.headers.get("x-og-downloads-source")).toBe("unavailable")
  expect(response.headers.get("cache-control")).toBe("no-store")
})

test("the download figure changes the rendered PNG", async () => {
  // Given: stars are fixed while the npm total differs between two cold renders on 2026-09-24.
  let downloads = 3_894_680
  spyOn(Date, "now").mockImplementation(() => Date.UTC(2026, 8, 24, 12))
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(async (input: RequestInfo | URL) => upstream(String(input), 69_355, downloads), {
      preconnect: fetch.preconnect,
    }),
  )
  resetOgStarsCacheForTests()
  resetOgDownloadsCacheForTests()
  const first = await OpenGraphImage()
  const firstPng = await first.arrayBuffer()

  // When: the npm total moves to a different displayed value.
  downloads = 1_500_000
  resetOgDownloadsCacheForTests()
  const second = await OpenGraphImage()

  // Then: 4 packages x 2 years, the one release binary and the mirror count are summed and the pixels differ.
  expect(first.headers.get("x-og-downloads")).toBe(String(3_894_680 * 10))
  expect(second.headers.get("x-og-downloads-source")).toBe("live")
  expect(Bun.hash(firstPng)).not.toBe(Bun.hash(await second.arrayBuffer()))
})
