import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureCodegraphProvisioned } from "./codegraph/provision"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

describe("ensureCodegraphProvisioned", () => {
  it("uses a completion marker to make provisioning idempotent", async () => {
    // given
    const installDir = tempDir("codegraph-provision")
    let downloads = 0

    // when
    const first = await ensureCodegraphProvisioned({
      downloader: async () => {
        downloads += 1
        return new TextEncoder().encode("#!/bin/sh\nexit 0\n")
      },
      installDir,
      lockDir: tempDir("locks"),
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: "306c6ca7407560340797866e077e053627ad409277d1b9da58106fce4cf717cb",
            url: "memory://codegraph",
          },
        },
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })
    const second = await ensureCodegraphProvisioned({
      installDir,
      lockDir: tempDir("locks-2"),
      manifest: {
        assets: {},
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })

    // then
    expect(first.provisioned).toBe(true)
    expect(second.provisioned).toBe(true)
    expect(downloads).toBe(1)

    rmSync(installDir, { force: true, recursive: true })
  })

  it("serializes concurrent calls with a per-host lock", async () => {
    // given
    const installDir = tempDir("codegraph-concurrent")
    const lockDir = tempDir("locks")
    let downloads = 0
    let resolveReleaseDownload: (release: () => void) => void = () => {}
    const releaseDownloadReady = new Promise<() => void>((resolve) => {
      resolveReleaseDownload = resolve
    })

    const first = ensureCodegraphProvisioned({
      downloader: () =>
        new Promise<Uint8Array>((resolve) => {
          downloads += 1
          resolveReleaseDownload(() => resolve(new TextEncoder().encode("#!/bin/sh\nexit 0\n")))
        }),
      installDir,
      lockDir,
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: "306c6ca7407560340797866e077e053627ad409277d1b9da58106fce4cf717cb",
            url: "memory://codegraph",
          },
        },
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })
    const releaseDownload = await releaseDownloadReady
    const second = ensureCodegraphProvisioned({
      installDir,
      lockDir,
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: "306c6ca7407560340797866e077e053627ad409277d1b9da58106fce4cf717cb",
            url: "memory://codegraph",
          },
        },
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })

    // when
    releaseDownload()
    const results = await Promise.all([first, second])

    // then
    expect(results.every((result: { readonly provisioned: boolean }) => result.provisioned)).toBe(true)
    expect(downloads).toBe(1)

    rmSync(installDir, { force: true, recursive: true })
    rmSync(lockDir, { force: true, recursive: true })
  })

  it("fails gracefully and removes partial installs on checksum mismatch", async () => {
    // given
    const installDir = tempDir("codegraph-bad-checksum")
    mkdirSync(installDir, { recursive: true })

    // when
    const result = await ensureCodegraphProvisioned({
      downloader: async () => new TextEncoder().encode("wrong"),
      installDir,
      lockDir: tempDir("locks"),
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: "0000",
            url: "memory://codegraph",
          },
        },
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })

    // then
    expect(result.provisioned).toBe(false)
    expect(result.error).toContain("checksum")
    expect(existsSync(join(installDir, "bin", "codegraph"))).toBe(false)

    rmSync(installDir, { force: true, recursive: true })
  })
})
