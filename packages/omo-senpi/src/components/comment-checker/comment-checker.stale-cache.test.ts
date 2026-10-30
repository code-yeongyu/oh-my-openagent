import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { COMMENT_CHECKER_RELEASE_VERSION, COMMENT_CHECKER_VERSION_MARKER } from "@oh-my-opencode/comment-checker-core"

import { createRecordingLogger, createTempCwd } from "./comment-checker.test-support"
import { downloadSenpiCommentCheckerBinary } from "./downloader"
import { resolveSenpiCommentCheckerBinary } from "./resolver"

const FRESH_BINARY = "#!/bin/sh\necho pinned-release\n"
const STALE_BINARY = "#!/bin/sh\necho v0.6.1-left-by-an-older-install\n"
const servers: Array<{ stop: (force?: boolean) => void }> = []

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop(true)
})

async function serveRelease(): Promise<{ url: string; requests: () => number }> {
  const stage = createTempCwd()
  writeFileSync(join(stage, "comment-checker"), FRESH_BINARY, { mode: 0o755 })
  const archive = join(createTempCwd(), "release.tar.gz")
  const result = Bun.spawnSync(["tar", "-czf", archive, "-C", stage, "comment-checker"], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`tar failed: ${new TextDecoder().decode(result.stderr)}`)
  const bytes = await Bun.file(archive).bytes()
  let requests = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests += 1
      return new Response(bytes, { headers: { "content-type": "application/gzip" } })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/release.tar.gz`, requests: () => requests }
}

function cacheWithBinary(marker?: string): string {
  const cacheDir = join(createTempCwd(), "bin")
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(join(cacheDir, "comment-checker"), STALE_BINARY, { mode: 0o755 })
  if (marker !== undefined) writeFileSync(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER), `${marker}\n`)
  return cacheDir
}

function resolveFromCacheOnly(cacheDir: string): string | null {
  return resolveSenpiCommentCheckerBinary({
    env: {},
    importMetaUrl: import.meta.url,
    requireModule: () => ({}),
    pathLookup: () => null,
    platform: "linux",
    cacheDir,
  })
}

describe("omo-senpi comment-checker shared cache is pinned to the release (#8850)", () => {
  for (const [label, marker] of [["no version marker", undefined], ["an older version marker", "0.6.1"]] as const) {
    it(`#given a cached checker with ${label} #when resolving #then the cache is not trusted`, () => {
      // given
      const cacheDir = cacheWithBinary(marker)

      // when
      const resolved = resolveFromCacheOnly(cacheDir)

      // then
      expect(resolved).toBeNull()
    })

    it(`#given a cached checker with ${label} #when downloading #then the pinned release replaces it and is recorded`, async () => {
      // given
      const cacheDir = cacheWithBinary(marker)
      const { url, requests } = await serveRelease()

      // when
      const binaryPath = await downloadSenpiCommentCheckerBinary({
        logger: createRecordingLogger(),
        platform: "linux",
        arch: "x64",
        cacheDir,
        resolveAssetUrl: () => url,
      })

      // then
      expect(binaryPath).toBe(join(cacheDir, "comment-checker"))
      expect(requests()).toBe(1)
      expect(readFileSync(join(cacheDir, "comment-checker"), "utf-8")).toBe(FRESH_BINARY)
      expect(readFileSync(join(cacheDir, COMMENT_CHECKER_VERSION_MARKER), "utf-8").trim()).toBe(COMMENT_CHECKER_RELEASE_VERSION)
      expect(resolveFromCacheOnly(cacheDir)).toBe(join(cacheDir, "comment-checker"))
    })
  }

  it("#given a cached checker recorded at the pinned release #when resolving #then the cache answers", () => {
    // given
    const cacheDir = cacheWithBinary(COMMENT_CHECKER_RELEASE_VERSION)

    // when
    const resolved = resolveFromCacheOnly(cacheDir)

    // then
    expect(resolved).toBe(join(cacheDir, "comment-checker"))
  })
})
