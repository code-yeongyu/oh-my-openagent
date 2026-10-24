import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AssetDownloadError, backoffDelayMs, downloadAssetFile, formatDownloadFailureSummary, isRetryableStatus } from "./mirror-download"

const FAST = { baseDelayMs: 1, maxDelayMs: 2, maxElapsedMs: 5_000 } as const

function fakeServer(handler: (requestCount: number) => Response): { readonly url: string; readonly requests: () => number; readonly stop: () => void } {
  let count = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => handler(++count),
  })
  return { url: `http://127.0.0.1:${server.port}/asset`, requests: () => count, stop: () => server.stop(true) }
}

async function tempPath(name: string): Promise<{ readonly dir: string; readonly path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "mirror-download-test-"))
  return { dir, path: join(dir, name) }
}

describe("downloadAssetFile", () => {
  test("succeeds when a fake server returns 500 a few times, then 200", async () => {
    const server = fakeServer((count) => (count <= 2 ? new Response("boom", { status: 500 }) : new Response("asset-bytes", { status: 200 })))
    const { dir, path } = await tempPath("omo-linux-x64")
    try {
      const result = await downloadAssetFile(server.url, "omo-linux-x64", path, FAST)
      expect(result.attempts).toBe(3)
      expect(result.status).toBe(200)
      expect(server.requests()).toBe(3)
      expect(await Bun.file(path).text()).toBe("asset-bytes")
    } finally {
      server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fails fast on 404 without retrying", async () => {
    const server = fakeServer(() => new Response("missing", { status: 404 }))
    const { dir, path } = await tempPath("omo-linux-x64")
    try {
      const failure = await downloadAssetFile(server.url, "omo-linux-x64", path, FAST).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AssetDownloadError)
      expect((failure as AssetDownloadError).status).toBe(404)
      expect((failure as AssetDownloadError).attempts).toBe(1)
      expect(server.requests()).toBe(1)
    } finally {
      server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("gives up inside the bounded window on persistent 500 and names the asset and last status", async () => {
    const server = fakeServer(() => new Response("boom", { status: 500 }))
    const { dir, path } = await tempPath("omo-linux-x64-musl")
    try {
      const failure = await downloadAssetFile(server.url, "omo-linux-x64-musl", path, { baseDelayMs: 5, maxDelayMs: 10, maxElapsedMs: 30 }).catch(
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(AssetDownloadError)
      const downloadError = failure as AssetDownloadError
      expect(downloadError.status).toBe(500)
      expect(downloadError.attempts).toBeGreaterThan(1)
      expect(downloadError.message).toContain("omo-linux-x64-musl")
      expect(downloadError.message).toContain("HTTP 500")
      expect(formatDownloadFailureSummary(downloadError)).toContain("omo-linux-x64-musl")
      expect(formatDownloadFailureSummary(downloadError)).toContain("HTTP 500")
      expect(server.requests()).toBe(downloadError.attempts)
    } finally {
      server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("retries a network error and then succeeds", async () => {
    const { dir, path } = await tempPath("omo-darwin-arm64")
    let calls = 0
    const fetchFn = (async () => {
      calls++
      if (calls === 1) throw new TypeError("fetch failed")
      return new Response("asset-bytes", { status: 200 })
    }) as unknown as typeof fetch
    try {
      const result = await downloadAssetFile("http://127.0.0.1/asset", "omo-darwin-arm64", path, { ...FAST, fetchFn })
      expect(result.attempts).toBe(2)
      expect(calls).toBe(2)
      expect(await Bun.file(path).text()).toBe("asset-bytes")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("retry policy", () => {
  test("only 5xx statuses are retryable", () => {
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(403)).toBe(false)
    expect(isRetryableStatus(200)).toBe(false)
  })

  test("backoff doubles per attempt and is capped", () => {
    expect(backoffDelayMs(1, 5_000, 60_000)).toBe(5_000)
    expect(backoffDelayMs(2, 5_000, 60_000)).toBe(10_000)
    expect(backoffDelayMs(3, 5_000, 60_000)).toBe(20_000)
    expect(backoffDelayMs(10, 5_000, 60_000)).toBe(60_000)
  })
})
