import { describe, expect, it } from "bun:test"

import { runtimeSlug, SG_PINNED_VERSION, SG_RELEASE_ASSETS, sgBinaryName } from "./sg-manifest"

describe("sg manifest", () => {
  it("builds the Node-style runtime slug for supported platforms", () => {
    // given
    const cases = [
      { arch: "arm64", platform: "darwin", slug: "darwin-arm64" },
      { arch: "x64", platform: "linux", slug: "linux-x64" },
      { arch: "x64", platform: "win32", slug: "win32-x64" },
    ] as const

    // when
    const slugs = cases.map((entry) => runtimeSlug(entry.platform, entry.arch))

    // then
    expect(slugs).toEqual(cases.map((entry) => entry.slug))
  })

  it("maps alternate arch spellings to the same runtime slug", () => {
    // given
    const aliases = ["x86_64", "amd64"] as const

    // when
    const slugs = aliases.map((arch) => runtimeSlug("linux", arch))

    // then
    expect(slugs).toEqual(["linux-x64", "linux-x64"])
  })

  it("pins ast-grep 0.43.0 assets and uses an exe name on Windows", () => {
    // given
    const asset = SG_RELEASE_ASSETS["win32-x64"]

    // when
    const binaryName = sgBinaryName("win32")

    // then
    expect(SG_PINNED_VERSION).toBe("0.43.0")
    expect(binaryName).toBe("sg.exe")
    expect(asset.url).toContain("/0.43.0/")
    expect(asset.sha256).toHaveLength(64)
  })
})
