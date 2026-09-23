import { afterEach, describe, expect, it } from "bun:test"
import { accessSync, constants, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { CommentCheckerReleaseAsset } from "@oh-my-opencode/comment-checker-core"

import { CACHE_DIR_NAME } from "../../../../omo-opencode/src/shared/plugin-identity"
import { createRecordingLogger, createTempCwd } from "./comment-checker.test-support"
import { COMMENT_CHECKER_CACHE_DIR_NAME } from "./constants"
import { downloadSenpiCommentCheckerBinary } from "./downloader"

const servers: Array<{ stop: (force?: boolean) => void }> = []

afterEach(() => {
  while (servers.length > 0) servers.pop()?.stop(true)
})

async function serveArchive(status = 200): Promise<{ url: string; requests: () => number }> {
  const stage = createTempCwd()
  writeFileSync(join(stage, "comment-checker"), "#!/bin/sh\necho fixture-checker\n", { mode: 0o755 })
  const archive = join(createTempCwd(), "fixture.tar.gz")
  const result = Bun.spawnSync(["tar", "-czf", archive, "-C", stage, "comment-checker"], { stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`tar failed: ${new TextDecoder().decode(result.stderr)}`)
  const bytes = await Bun.file(archive).bytes()
  let requests = 0
  const server = Bun.serve({
    port: 0,
    fetch() {
      requests += 1
      return status === 200 ? new Response(bytes, { headers: { "content-type": "application/gzip" } }) : new Response(null, { status })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/asset.tar.gz`, requests: () => requests }
}

const toLocal = (url: string) => (_asset: CommentCheckerReleaseAsset) => url

describe("omo-senpi comment-checker downloader", () => {
  it("#given both editions #when the cache dir name is compared #then one download serves both", () => {
    expect(COMMENT_CHECKER_CACHE_DIR_NAME).toBe(CACHE_DIR_NAME)
  })

  it("#given an empty cache and a reachable release #when downloading #then the binary lands executable and the archive is removed", async () => {
    // given
    const cacheDir = join(createTempCwd(), "bin")
    const logger = createRecordingLogger()
    const { url, requests } = await serveArchive()

    // when
    const binaryPath = await downloadSenpiCommentCheckerBinary({ logger, platform: "linux", arch: "x64", cacheDir, resolveAssetUrl: toLocal(url) })

    // then
    expect(binaryPath).toBe(join(cacheDir, "comment-checker"))
    expect(existsSync(binaryPath ?? "")).toBe(true)
    expect(() => accessSync(binaryPath ?? "", constants.X_OK)).not.toThrow()
    expect(readdirSync(cacheDir)).toEqual(["comment-checker"])
    expect(requests()).toBe(1)
    expect(logger.entries.map((entry) => entry.level)).toEqual(["info"])
  })

  it("#given a cached binary #when downloading again #then the cache answers without a request", async () => {
    // given
    const cacheDir = join(createTempCwd(), "bin")
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, "comment-checker"), "#!/bin/sh\n", { mode: 0o755 })
    const logger = createRecordingLogger()
    const { url, requests } = await serveArchive()

    // when
    const binaryPath = await downloadSenpiCommentCheckerBinary({ logger, platform: "linux", arch: "x64", cacheDir, resolveAssetUrl: toLocal(url) })

    // then
    expect(binaryPath).toBe(join(cacheDir, "comment-checker"))
    expect(requests()).toBe(0)
    expect(logger.entries).toEqual([])
  })

  it("#given the release endpoint fails #when downloading #then it returns null with one warning and no partial files", async () => {
    // given
    const cacheDir = join(createTempCwd(), "bin")
    const logger = createRecordingLogger()
    const { url } = await serveArchive(503)

    // when
    const binaryPath = await downloadSenpiCommentCheckerBinary({ logger, platform: "linux", arch: "x64", cacheDir, resolveAssetUrl: toLocal(url) })

    // then
    expect(binaryPath).toBeNull()
    expect(logger.entries.map((entry) => entry.level)).toEqual(["info", "warn"])
    expect(logger.entries[1]?.message).toBe("omo-senpi comment-checker download failed")
    expect(existsSync(cacheDir) ? readdirSync(cacheDir) : []).toEqual([])
  })

  it("#given an unsupported platform #when downloading #then it returns null without contacting the network", async () => {
    // given
    const logger = createRecordingLogger()
    const { url, requests } = await serveArchive()

    // when
    const binaryPath = await downloadSenpiCommentCheckerBinary({ logger, platform: "freebsd", arch: "x64", cacheDir: createTempCwd(), resolveAssetUrl: toLocal(url) })

    // then
    expect(binaryPath).toBeNull()
    expect(requests()).toBe(0)
    expect(logger.entries.map((entry) => entry.level)).toEqual(["warn"])
  })
})
