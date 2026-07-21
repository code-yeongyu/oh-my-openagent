import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CODEGRAPH_PROVISION_MANIFEST } from "./codegraph/manifest"
import { ensureCodegraphProvisioned } from "./codegraph/provision"

const ARCHIVE_EXTRACTION_TEST_TIMEOUT_MS = 15_000

function tempDir(name: string): string {
  return join(tmpdir(), `omo-${name}-${crypto.randomUUID()}`)
}

function fixtureArchive(
  options: { readonly executableName?: string; readonly rootName?: string } = {},
): { readonly bytes: Uint8Array; readonly sha256: string } {
  const root = tempDir("codegraph-archive")
  const rootName = options.rootName ?? "codegraph-darwin-arm64"
  const executableName = options.executableName ?? "codegraph"
  const archive = join(root, `${rootName}.tar.gz`)
  const binDir = join(root, rootName, "bin")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, executableName), "#!/bin/sh\nprintf 'codegraph fixture\\n'\n")
  execFileSync("chmod", ["755", join(binDir, executableName)])
  execFileSync("tar", ["-czf", archive, rootName], { cwd: root })
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
      version: "1.4.1",
    })

    // then
    expect(result.provisioned).toBe(false)
    expect(result.error).toContain("checksum mismatch")
    expect(result.error).not.toContain("no CodeGraph 1.4.1 asset")

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
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
    })

    // then
    expect(result).toEqual({ binPath: join(installDir, "bin", "codegraph"), provisioned: true })
    expect(readFileSync(join(installDir, "bin", "codegraph"), "utf8")).toContain("codegraph fixture")

    rmSync(installDir, { force: true, recursive: true })
  }, { timeout: ARCHIVE_EXTRACTION_TEST_TIMEOUT_MS })

  it("declares pinned Windows npm package assets in the default manifest", () => {
    // given
    const assets = CODEGRAPH_PROVISION_MANIFEST.assets

    // when
    const win32X64 = assets["win32-x64"]
    const win32Arm64 = assets["win32-arm64"]

    // then
    expect(win32X64).toEqual({
      executableName: "codegraph.cmd",
      sha256: "4f08700fda5f4a03ad5b2956135c5788d739a351b3433db2b5820e5d5224c30d",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.4.1.tgz",
    })
    expect(win32Arm64).toEqual({
      executableName: "codegraph.cmd",
      sha256: "e2a2a28c802a79804c7df203afa50bd461309c6c180ce3f76079fdc7cddc7697",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.4.1.tgz",
    })
  })

  it("extracts a verified npm tgz archive and installs bin/codegraph.cmd", async () => {
    // given
    const installDir = tempDir("codegraph-npm-tgz-install")
    const archive = fixtureArchive({ executableName: "codegraph.cmd", rootName: "package" })

    // when
    const result = await ensureCodegraphProvisioned({
      downloader: async () => archive.bytes,
      installDir,
      lockDir: tempDir("locks"),
      manifest: {
        assets: {
          "win32-x64": {
            executableName: "codegraph.cmd",
            sha256: archive.sha256,
            url: "memory://codegraph-win32-x64-1.4.1.tgz",
          },
        },
        version: "1.4.1",
      },
      platformKey: "win32-x64",
      version: "1.4.1",
    })

    // then
    expect(result).toEqual({ binPath: join(installDir, "bin", "codegraph.cmd"), provisioned: true })
    expect(readFileSync(join(installDir, "bin", "codegraph.cmd"), "utf8")).toContain("codegraph fixture")

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
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
    })
    const second = await ensureCodegraphProvisioned({
      installDir,
      lockDir: tempDir("locks-2"),
      manifest: {
        assets: {},
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
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
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
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
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
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
        version: "1.4.1",
      },
      platformKey: "darwin-arm64",
      version: "1.4.1",
    })

    // then
    expect(result.provisioned).toBe(false)
    expect(result.error).toContain("checksum")
    expect(existsSync(join(installDir, "bin", "codegraph"))).toBe(false)

    rmSync(installDir, { force: true, recursive: true })
  })
})
