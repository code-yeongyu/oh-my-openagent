/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { COMMENT_CHECKER_RELEASE_VERSION, COMMENT_CHECKER_VERSION_MARKER } from "@oh-my-opencode/comment-checker-core"

import { ensureCommentCheckerBinary, getCacheDir, getCachedBinaryPath } from "./downloader"

const FRESH_BINARY = "#!/bin/sh\necho pinned-release\n"
const STALE_BINARY = "#!/bin/sh\necho left-by-an-older-install\n"

let root: string
let savedCacheHome: string | undefined
let savedFetch: typeof fetch

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cc-opencode-stale-"))
  savedCacheHome = process.env.XDG_CACHE_HOME
  process.env.XDG_CACHE_HOME = root
  savedFetch = globalThis.fetch
})

afterEach(() => {
  globalThis.fetch = savedFetch
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = savedCacheHome
  rmSync(root, { recursive: true, force: true })
})

function plantCachedBinary(marker?: string): string {
  const cacheDir = getCacheDir()
  mkdirSync(cacheDir, { recursive: true })
  const binaryPath = join(cacheDir, "comment-checker")
  writeFileSync(binaryPath, STALE_BINARY, { mode: 0o755 })
  if (marker !== undefined) writeFileSync(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER), `${marker}\n`)
  return binaryPath
}

async function serveReleaseThroughFetch(): Promise<() => number> {
  const stage = mkdtempSync(join(root, "stage-"))
  writeFileSync(join(stage, "comment-checker"), FRESH_BINARY, { mode: 0o755 })
  const archive = join(root, "release.tar.gz")
  const tar = Bun.spawnSync(["tar", "-czf", archive, "-C", stage, "comment-checker"], { stdout: "pipe", stderr: "pipe" })
  if (tar.exitCode !== 0) throw new Error(`tar failed: ${new TextDecoder().decode(tar.stderr)}`)
  const bytes = await Bun.file(archive).bytes()
  let requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    return new Response(bytes, { headers: { "content-type": "application/gzip" } })
  }) as unknown as typeof fetch
  return () => requests
}

describe.skipIf(process.platform === "win32")("OpenCode comment-checker shared cache is pinned to the release (#8850)", () => {
  for (const [label, marker] of [["no version marker", undefined], ["an older version marker", "0.6.1"]] as const) {
    it(`#given a cached checker with ${label} #when looking up the cache #then it is not trusted`, () => {
      // given
      plantCachedBinary(marker)

      // when
      const cached = getCachedBinaryPath()

      // then
      expect(cached).toBeNull()
    })

    it(`#given a cached checker with ${label} #when ensuring the binary #then the pinned release replaces it and is recorded`, async () => {
      // given
      const binaryPath = plantCachedBinary(marker)
      const requests = await serveReleaseThroughFetch()

      // when
      const ensured = await ensureCommentCheckerBinary()

      // then
      expect(ensured).toBe(binaryPath)
      expect(requests()).toBe(1)
      expect(readFileSync(binaryPath, "utf-8")).toBe(FRESH_BINARY)
      expect(readFileSync(join(getCacheDir(), COMMENT_CHECKER_VERSION_MARKER), "utf-8").trim()).toBe(COMMENT_CHECKER_RELEASE_VERSION)
      expect(getCachedBinaryPath()).toBe(binaryPath)
    })
  }

  it("#given a cached checker recorded at the pinned release #when ensuring the binary #then the cache answers without a request", async () => {
    // given
    const binaryPath = plantCachedBinary(COMMENT_CHECKER_RELEASE_VERSION)
    const requests = await serveReleaseThroughFetch()

    // when
    const ensured = await ensureCommentCheckerBinary()

    // then
    expect(ensured).toBe(binaryPath)
    expect(requests()).toBe(0)
    expect(readFileSync(binaryPath, "utf-8")).toBe(STALE_BINARY)
  })
})
