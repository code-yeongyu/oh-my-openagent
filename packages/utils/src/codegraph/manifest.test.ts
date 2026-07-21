import { describe, expect, it } from "bun:test"

import { CODEGRAPH_PINNED_VERSION, CODEGRAPH_PROVISION_MANIFEST } from "./manifest"

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const EXPECTED_PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"] as const

describe("CODEGRAPH_PROVISION_MANIFEST", () => {
  it("pins CodeGraph 1.4.1 across the manifest version and every asset URL", () => {
    // given
    const manifest = CODEGRAPH_PROVISION_MANIFEST

    // when
    const platforms = Object.keys(manifest.assets).sort()
    const urls = Object.values(manifest.assets).map((asset) => asset.url)

    // then
    expect(CODEGRAPH_PINNED_VERSION).toBe("1.4.1")
    expect(manifest.version).toBe("1.4.1")
    expect(platforms).toEqual([...EXPECTED_PLATFORMS].sort())
    for (const url of urls) {
      expect(url).toContain("1.4.1")
    }
  })

  it("declares a 64-hex sha256 for every pinned asset", () => {
    // given
    const assets = CODEGRAPH_PROVISION_MANIFEST.assets

    // when
    const entries = Object.entries(assets)

    // then
    expect(entries).toHaveLength(6)
    for (const [platform, asset] of entries) {
      expect(asset.sha256, `${platform} sha256`).toMatch(SHA256_HEX_PATTERN)
    }
  })

  it("keeps the npm .tgz scheme for win32 assets and github releases for darwin/linux", () => {
    // given
    const assets = CODEGRAPH_PROVISION_MANIFEST.assets

    // when
    const win32Arm64 = assets["win32-arm64"]
    const win32X64 = assets["win32-x64"]
    const darwinArm64 = assets["darwin-arm64"]
    const darwinX64 = assets["darwin-x64"]
    const linuxArm64 = assets["linux-arm64"]
    const linuxX64 = assets["linux-x64"]

    // then
    expect(win32Arm64?.url).toBe(
      "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.4.1.tgz",
    )
    expect(win32X64?.url).toBe(
      "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.4.1.tgz",
    )
    expect(win32Arm64?.executableName).toBe("codegraph.cmd")
    expect(win32X64?.executableName).toBe("codegraph.cmd")

    expect(darwinArm64?.url).toBe(
      "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-darwin-arm64.tar.gz",
    )
    expect(darwinX64?.url).toBe(
      "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-darwin-x64.tar.gz",
    )
    expect(linuxArm64?.url).toBe(
      "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-linux-arm64.tar.gz",
    )
    expect(linuxX64?.url).toBe(
      "https://github.com/colbymchenry/codegraph/releases/download/v1.4.1/codegraph-linux-x64.tar.gz",
    )
  })
})
