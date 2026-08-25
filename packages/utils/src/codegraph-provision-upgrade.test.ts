import { describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CODEGRAPH_PINNED_VERSION } from "./codegraph/manifest"
import { ensureCodegraphProvisioned } from "./codegraph/provision"

// The first `tar` invocation on a cold Windows runner can exceed Bun's 5000ms default
// (observed 5203-6031ms against 125ms warm); see fa6740ae8 for the same repair on the sibling file.
const ARCHIVE_FIXTURE_TEST_TIMEOUT_MS = 15_000

function createArchive(root: string): { readonly bytes: Uint8Array; readonly sha256: string } {
  const bundleName = "codegraph-darwin-arm64"
  const archivePath = join(root, `${bundleName}.tar.gz`)
  const binDir = join(root, bundleName, "bin")
  mkdirSync(binDir, { recursive: true })
  writeFileSync(join(binDir, "codegraph"), "#!/bin/sh\nprintf 'upgraded codegraph\\n'\n", { mode: 0o755 })
  execFileSync("tar", ["-czf", archivePath, bundleName], { cwd: root })
  const bytes = readFileSync(archivePath)
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") }
}

describe("ensureCodegraphProvisioned version upgrades", () => {
  for (const staleVersion of ["1.0.1", "1.4.1"] as const) {
    it(`#given a managed ${staleVersion} runtime #when provisioning the current pin #then it replaces the stale runtime`, async () => {
      // given
      const root = mkdtempSync(join(tmpdir(), "omo-codegraph-provision-stale-marker-"))
      const installDir = join(root, "install")
      const staleBin = join(installDir, "bin", "codegraph")
      const staleMarkerPath = join(installDir, ".provisioned", `codegraph-${staleVersion}.json`)
      mkdirSync(join(installDir, "bin"), { recursive: true })
      mkdirSync(join(installDir, ".provisioned"), { recursive: true })
      writeFileSync(staleBin, "stale codegraph\n", { mode: 0o755 })
      writeFileSync(staleMarkerPath, `${JSON.stringify({ binPath: staleBin, version: staleVersion })}\n`)
      const archive = createArchive(root)
      let downloads = 0

      try {
        // when
        const result = await ensureCodegraphProvisioned({
          downloader: async () => {
            downloads += 1
            return archive.bytes
          },
          installDir,
          lockDir: join(root, "locks"),
          manifest: {
            assets: {
              "darwin-arm64": {
                executableName: "codegraph",
                sha256: archive.sha256,
                url: "memory://codegraph-darwin-arm64.tar.gz",
              },
            },
            version: CODEGRAPH_PINNED_VERSION,
          },
          platformKey: "darwin-arm64",
          version: CODEGRAPH_PINNED_VERSION,
        })

        // then
        expect(result).toEqual({ binPath: staleBin, provisioned: true })
        expect(downloads).toBe(1)
        expect(readFileSync(staleBin, "utf8")).toContain("upgraded codegraph")
        expect(JSON.parse(readFileSync(join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`), "utf8"))).toEqual({
          binPath: staleBin,
          version: CODEGRAPH_PINNED_VERSION,
        })
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }, { timeout: ARCHIVE_FIXTURE_TEST_TIMEOUT_MS })
  }

  it("#given a stale managed runtime #when the replacement archive fails verification #then the previous runtime remains intact", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-codegraph-provision-atomic-upgrade-"))
    const installDir = join(root, "install")
    const staleBin = join(installDir, "bin", "codegraph")
    mkdirSync(join(installDir, "bin"), { recursive: true })
    mkdirSync(join(installDir, ".provisioned"), { recursive: true })
    writeFileSync(staleBin, "stale codegraph\n", { mode: 0o755 })
    writeFileSync(
      join(installDir, ".provisioned", "codegraph-1.4.1.json"),
      `${JSON.stringify({ binPath: staleBin, version: "1.4.1" })}\n`,
    )

    try {
      // when
      const result = await ensureCodegraphProvisioned({
        downloader: async () => new TextEncoder().encode("invalid archive"),
        installDir,
        lockDir: join(root, "locks"),
        manifest: {
          assets: {
            "darwin-arm64": {
              executableName: "codegraph",
              sha256: "0000",
              url: "memory://codegraph-darwin-arm64.tar.gz",
            },
          },
          version: CODEGRAPH_PINNED_VERSION,
        },
        platformKey: "darwin-arm64",
        version: CODEGRAPH_PINNED_VERSION,
      })

      // then
      expect(result.provisioned).toBe(false)
      expect(result.error).toContain("checksum mismatch")
      expect(readFileSync(staleBin, "utf8")).toBe("stale codegraph\n")
      expect(existsSync(join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`))).toBe(false)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it("#given a managed binary whose marker version does not match the requested pin #when provisioning #then it replaces the stale runtime", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-codegraph-provision-upgrade-"))
    const installDir = join(root, "install")
    const staleBin = join(installDir, "bin", "codegraph")
    const markerPath = join(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`)
    mkdirSync(join(installDir, "bin"), { recursive: true })
    mkdirSync(join(installDir, ".provisioned"), { recursive: true })
    writeFileSync(staleBin, "stale codegraph\n", { mode: 0o755 })
    writeFileSync(markerPath, `${JSON.stringify({ binPath: staleBin, version: "1.0.1" })}\n`)
    const archive = createArchive(root)
    let downloads = 0

    try {
      // when
      const result = await ensureCodegraphProvisioned({
        downloader: async () => {
          downloads += 1
          return archive.bytes
        },
        installDir,
        lockDir: join(root, "locks"),
        manifest: {
          assets: {
            "darwin-arm64": {
              executableName: "codegraph",
              sha256: archive.sha256,
              url: "memory://codegraph-darwin-arm64.tar.gz",
            },
          },
          version: CODEGRAPH_PINNED_VERSION,
        },
        platformKey: "darwin-arm64",
        version: CODEGRAPH_PINNED_VERSION,
      })

      // then
      expect(result).toEqual({ binPath: staleBin, provisioned: true })
      expect(downloads).toBe(1)
      expect(readFileSync(staleBin, "utf8")).toContain("upgraded codegraph")
      expect(JSON.parse(readFileSync(markerPath, "utf8"))).toEqual({
        binPath: staleBin,
        version: CODEGRAPH_PINNED_VERSION,
      })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  }, { timeout: ARCHIVE_FIXTURE_TEST_TIMEOUT_MS })
})
