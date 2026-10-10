import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DESKTOP_ENGINE_CHECKSUMS_ASSET,
  DESKTOP_ENGINE_RELEASE_HOSTS,
  desktopEngineReleaseAssetName,
} from "../packages/senpi-desktop-engine/src/release-assets"
import { stageDesktopEngineReleaseAsset, writeDesktopEngineChecksums } from "./desktop-engine-release"

describe("desktop engine GitHub release assets", () => {
  test("the publisher and acquisition use the same four concrete asset names", () => {
    expect(DESKTOP_ENGINE_RELEASE_HOSTS.map((host) => desktopEngineReleaseAssetName(host))).toEqual([
      "senpi-desktop-engine-darwin-arm64",
      "senpi-desktop-engine-darwin-x64",
      "senpi-desktop-engine-linux-x64",
      "senpi-desktop-engine-win32-x64.exe",
    ])
    expect(DESKTOP_ENGINE_CHECKSUMS_ASSET).toBe("senpi-desktop-engine-checksums.txt")
  })

  test("a release dry run stages and checksums every required binary without publishing", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-desktop-release-"))
    try {
      const source = join(root, "source")
      const staged = join(root, "assets")
      const contents = Buffer.from("engine fixture")
      writeFileSync(source, contents)
      const signed: string[] = []
      for (const host of DESKTOP_ENGINE_RELEASE_HOSTS) {
        stageDesktopEngineReleaseAsset(host, source, staged, (path) => { signed.push(path) })
      }

      const checksums = writeDesktopEngineChecksums(staged)
      const digest = createHash("sha256").update(contents).digest("hex")
      expect(readFileSync(checksums, "utf8")).toBe(
        DESKTOP_ENGINE_RELEASE_HOSTS.map((host) => `${digest}  ${desktopEngineReleaseAssetName(host)}`).join("\n") + "\n",
      )
      expect(signed).toHaveLength(2)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test("missing available assets fail the release instead of publishing a partial checksum list", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-desktop-partial-"))
    try {
      writeFileSync(join(root, "source"), "one")
      stageDesktopEngineReleaseAsset("linux-x64", join(root, "source"), root)
      expect(() => writeDesktopEngineChecksums(root)).toThrow(/missing required desktop engine release asset/)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
