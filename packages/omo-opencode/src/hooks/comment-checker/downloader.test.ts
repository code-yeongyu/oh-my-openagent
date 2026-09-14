/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"

const probeResult = z.object({
  urls: z.array(z.string()),
  resolutionAttempts: z.number().int().nonnegative(),
  result: z.string().nullable(),
})

const platforms = [
  { platform: "darwin", arch: "arm64", asset: "darwin_arm64.tar.gz" },
  { platform: "darwin", arch: "x64", asset: "darwin_amd64.tar.gz" },
  { platform: "linux", arch: "arm64", asset: "linux_arm64.tar.gz" },
  { platform: "linux", arch: "x64", asset: "linux_amd64.tar.gz" },
  { platform: "win32", arch: "x64", asset: "windows_amd64.zip" },
  { platform: "freebsd", arch: "x64", asset: null },
] as const

describe("comment-checker release download", () => {
  for (const target of platforms) {
    it(`uses the pinned release without npm resolution on ${target.platform}/${target.arch}`, async () => {
      // given an empty isolated cache and no npm package resolution
      const directory = await mkdtemp(join(tmpdir(), "comment-checker-download-"))
      try {
        const child = Bun.spawn([
          process.execPath,
          "run",
          join(import.meta.dir, "__fixtures__/download-probe.fixture.ts"),
          JSON.stringify(target),
        ], {
          env: {
            ...process.env,
            XDG_CACHE_HOME: directory,
            LOCALAPPDATA: directory,
            TMPDIR: directory,
            COMMENT_CHECKER_DEBUG: "0",
          },
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(10_000),
        })

        // when the downloader handles an unavailable release endpoint
        const [exitCode, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])

        // then URL selection is platform-correct, package-independent and graceful
        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
        const result = probeResult.parse(JSON.parse(stdout))
        expect(result.urls).toEqual(target.asset === null ? [] : [
          `https://github.com/code-yeongyu/go-claude-code-comment-checker/releases/download/v0.8.0/comment-checker_v0.8.0_${target.asset}`,
        ])
        expect(result.resolutionAttempts).toBe(0)
        expect(result.result).toBeNull()
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
})
