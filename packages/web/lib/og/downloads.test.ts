/// <reference types="bun" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { formatOgDownloads, getOgDownloads, resetOgDownloadsCacheForTests } from "./downloads"

const POINT = /^https:\/\/api\.npmjs\.org\/downloads\/point\/([^/]+)\/([^/]+)$/
const RELEASES =
  "https://api.github.com/repos/code-yeongyu/oh-my-openagent/releases?per_page=30&page=1"
const NATIVE = 32_000
const INSTALLER_STATS = "https://get.omo.dev/stats/downloads"
const INSTALLER = 700
const releasesPage = () =>
  Response.json([
    {
      assets: [
        { name: "omo-darwin-arm64", download_count: NATIVE },
        { name: "SHA256SUMS", download_count: 9 },
      ],
    },
  ])
const PER_PACKAGE: Readonly<Record<string, number>> = {
  "oh-my-opencode": 1_000_000,
  "oh-my-openagent": 200_000,
  "omo-ai": 30_000,
  "lazycodex-ai": 4_000,
}

let now = Date.UTC(2026, 8, 24, 12)
const LINEAGE = Object.keys(PER_PACKAGE).join(",")

function bulk(packages: readonly string[], entry: (pkg: string) => unknown): Response {
  return Response.json(Object.fromEntries(packages.map((pkg) => [pkg, entry(pkg)])))
}

const counted = (pkg: string) => ({ downloads: PER_PACKAGE[pkg] ?? 0, package: pkg })

let reply: (range: string, packages: readonly string[]) => Promise<Response>
let replyReleases: () => Promise<Response>
let replyInstaller: () => Promise<Response>
const requests: string[] = []

beforeEach(() => {
  resetOgDownloadsCacheForTests()
  now = Date.UTC(2026, 8, 24, 12)
  requests.length = 0
  reply = async (_range, packages) => bulk(packages, counted)
  replyReleases = async () => releasesPage()
  replyInstaller = async () =>
    Response.json({ uncountedByGitHub: INSTALLER, redirectedToGitHub: 12 })
  spyOn(Date, "now").mockImplementation(() => now)
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        requests.push(url)
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        expect(init?.cache).toBe("no-store")
        if (url === RELEASES) return replyReleases()
        if (url === INSTALLER_STATS) return replyInstaller()
        const match = POINT.exec(url)
        if (!match) throw new Error(`unexpected fetch ${url}`)
        return reply(match[1] ?? "", (match[2] ?? "").split(","))
      },
      { preconnect: fetch.preconnect },
    ),
  )
})

afterEach(() => {
  mock.restore()
  resetOgDownloadsCacheForTests()
})

describe("OG download formatting", () => {
  test.each([
    [null, null],
    [0, "0 Downloads"],
    [999, "999 Downloads"],
    [1_000, "1K+ Downloads"],
    [999_999, "999K+ Downloads"],
    [1_000_000, "1M+ Downloads"],
    [3_894_680, "3.8M+ Downloads"],
    [4_032_665, "4M+ Downloads"],
    [12_345_678, "12.3M+ Downloads"],
  ])("formats %s without rounding up", (count, label) => {
    expect(formatOgDownloads(count)).toBe(label)
  })
})

describe("OG npm download retrieval", () => {
  test("sums every lineage package over every calendar year since first publish", async () => {
    // Given: each package reports its own count for every yearly range.
    // When: the all-time figure is computed on 2026-09-24.
    const result = await getOgDownloads()

    // Then: one bulk request per year covers all 4 packages, 4 x 2 counts are summed, and the
    // release binaries (not the checksum file) are added once.
    expect(result).toEqual({
      count: 2_468_000 + NATIVE + INSTALLER,
      source: "live",
      expiresAt: now + 3_600_000,
    })
    expect([...requests].sort()).toEqual([
      RELEASES,
      `https://api.npmjs.org/downloads/point/2025-01-01:2025-12-31/${LINEAGE}`,
      `https://api.npmjs.org/downloads/point/2026-01-01:2026-09-24/${LINEAGE}`,
      INSTALLER_STATS,
    ])
  })

  test("a failing release page withholds the figure instead of an npm-only sum", async () => {
    replyReleases = async () => new Response("Rate limited", { status: 403 })

    expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
  })

  test("failing get.omo.dev stats withhold the figure instead of a total without mirror installs", async () => {
    replyInstaller = async () => new Response("Bad gateway", { status: 502 })

    expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
  })

  test("one failing package withholds the figure instead of a partial sum", async () => {
    // Given: a cold renderer and one yearly range failing.
    reply = async (range, packages) =>
      range.startsWith("2026")
        ? new Response("Unavailable", { status: 503 })
        : bulk(packages, counted)

    // When / Then: nothing partial is presented, and the next request recovers.
    expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
    reply = async (_range, packages) => bulk(packages, counted)
    expect((await getOgDownloads()).count).toBe(2_468_000 + NATIVE + INSTALLER)
  })

  test("a package missing from the bulk reply withholds the figure", async () => {
    // Given: npm answers the bulk query but reports one package as null.
    reply = async (_range, packages) =>
      bulk(packages, (pkg) => (pkg === "lazycodex-ai" ? null : counted(pkg)))

    // When / Then: the other three packages are not presented as the total.
    expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
  })

  test.each([{}, { downloads: -1 }, { downloads: 1.5 }, { downloads: "10" }])(
    "rejects invalid npm data %j",
    async (payload) => {
      reply = async (_range, packages) => bulk(packages, () => payload)
      expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
    },
  )

  test("reuses fresh data and coalesces concurrent requests", async () => {
    const results = await Promise.all([getOgDownloads(), getOgDownloads()])
    await getOgDownloads()
    expect(results.map((item) => item.count)).toEqual([
      2_468_000 + NATIVE + INSTALLER,
      2_468_000 + NATIVE + INSTALLER,
    ])
    expect(requests).toHaveLength(4)
  })

  test("serves last known good for at most a day after the hour expires", async () => {
    await getOgDownloads()
    now += 3_600_000
    reply = async () => new Response("Rate limited", { status: 429 })
    expect(await getOgDownloads()).toEqual({
      count: 2_468_000 + NATIVE + INSTALLER,
      source: "stale",
    })
    now += 86_400_000
    expect(await getOgDownloads()).toEqual({ count: null, source: "unavailable" })
  })
})
