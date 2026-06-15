import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ensureCodegraphProvisioned } from "./codegraph/provision"

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

function fixtureArchive(): { readonly bytes: Uint8Array; readonly sha256: string } {
  const root = tempDir("codegraph-archive")
  const archive = join(root, "codegraph-darwin-arm64.tar.gz")
  const binDir = join(root, "codegraph-darwin-arm64", "bin")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, "codegraph"), "#!/bin/sh\nprintf 'codegraph fixture\\n'\n")
  execFileSync("chmod", ["755", join(binDir, "codegraph")])
  execFileSync("tar", ["-czf", archive, "codegraph-darwin-arm64"], { cwd: root })
  const bytes = readFileSync(archive)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  rmSync(root, { force: true, recursive: true })
  return { bytes, sha256 }
}

describe("ensureCodegraphProvisioned", () => {
  it("uses the default pinned manifest when no manifest override is supplied", async () => {
    // given
    const installDir = tempDir("codegraph-default-manifest")

    // when
    const result = await ensureCodegraphProvisioned({
      downloader: async () => new TextEncoder().encode("not the real archive"),
      installDir,
      lockDir: tempDir("locks"),
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })

    // then
    expect(result.provisioned).toBe(false)
    expect(result.error).toContain("checksum mismatch")
    expect(result.error).not.toContain("no CodeGraph 1.0.1 asset")

    rmSync(installDir, { force: true, recursive: true })
  })

  it("extracts a verified release archive and installs bin/codegraph", async () => {
    // given
    const installDir = tempDir("codegraph-archive-install")
    const archive = fixtureArchive()

    // when
    const result = await ensureCodegraphProvisioned({
      downloader: async () => archive.bytes,
      installDir,
      lockDir: tempDir("locks"),
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: archive.sha256,
            url: "memory://codegraph-darwin-arm64.tar.gz",
          },
        },
        version: "1.0.1",
      },
      platformKey: "darwin-arm64",
      version: "1.0.1",
    })

    // then
    expect(result).toEqual({ binPath: join(installDir, "bin", "codegraph"), provisioned: true })
    expect(readFileSync(join(installDir, "bin", "codegraph"), "utf8")).toContain("codegraph fixture")

    rmSync(installDir, { force: true, recursive: true })
  })

  it("uses a completion marker to make provisioning idempotent", async () => {
    // given
    const installDir = tempDir("codegraph-provision")
    const archive = fixtureArchive()
    let downloads = 0

    // when
    const first = await ensureCodegraphProvisioned({
      downloader: async () => {
        downloads += 1
        return archive.bytes
      },
      installDir,
      lockDir: tempDir("locks"),
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: archive.sha256,
            url: "memory://codegraph-darwin-arm64.tar.gz",
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
    const archive = fixtureArchive()
    let downloads = 0
    let resolveReleaseDownload: (release: () => void) => void = () => {}
    const releaseDownloadReady = new Promise<() => void>((resolve) => {
      resolveReleaseDownload = resolve
    })

    const first = ensureCodegraphProvisioned({
      downloader: () =>
        new Promise<Uint8Array>((resolve) => {
          downloads += 1
          resolveReleaseDownload(() => resolve(archive.bytes))
        }),
      installDir,
      lockDir,
      manifest: {
        assets: {
          "darwin-arm64": {
            executableName: "codegraph",
            sha256: archive.sha256,
            url: "memory://codegraph-darwin-arm64.tar.gz",
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
            sha256: archive.sha256,
            url: "memory://codegraph-darwin-arm64.tar.gz",
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
