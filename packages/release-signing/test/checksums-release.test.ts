import { describe, expect, test } from "bun:test"
import { buildChecksumsRelease, compareReleaseVersion, parseChecksumsRelease } from "../src/checksums-release.ts"

// #14916 H2: the signed checksum-list grammar is FROZEN (keyring checklist item 5). These are its owners: every
// surface's parser must reject exactly these malformations, and the build/parse round trip must be the identity.
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)
const good = `# omo-release-v1 version=5.2.0 channel=stable\n${SHA_A}  omo-linux-x64\n${SHA_B}  omo-darwin-arm64\n`

describe("checksums-release grammar", () => {
  test("parses the frozen header and every asset line", () => {
    const verdict = parseChecksumsRelease(utf8(good))
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.version).toBe("5.2.0")
      expect(verdict.channel).toBe("stable")
      expect(verdict.entries.get("omo-linux-x64")).toBe(SHA_A)
      expect(verdict.entries.get("omo-darwin-arm64")).toBe(SHA_B)
    }
  })

  test("refuses CRLF, a missing trailing LF, and a missing header", () => {
    expect(parseChecksumsRelease(utf8(good.replace(/\n/g, "\r\n"))).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(good.slice(0, -1))).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(good.split("\n").slice(1).join("\n"))).ok).toBe(false)
  })

  test("refuses a wrong domain token, an unknown channel and a malformed version", () => {
    expect(parseChecksumsRelease(utf8(good.replace("omo-release-v1", "omo-desktop-manifest"))).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(good.replace("channel=stable", "channel=nightly"))).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(good.replace("version=5.2.0", "version=5.2"))).ok).toBe(false)
  })

  test("refuses duplicate names, uppercase hex, one-space separators and empty files", () => {
    expect(parseChecksumsRelease(utf8(`# omo-release-v1 version=5.2.0 channel=stable\n${SHA_A}  omo-linux-x64\n${SHA_B}  omo-linux-x64\n`)).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(`# omo-release-v1 version=5.2.0 channel=stable\n${SHA_A.toUpperCase()}  omo-linux-x64\n`)).ok).toBe(false)
    expect(parseChecksumsRelease(utf8(`# omo-release-v1 version=5.2.0 channel=stable\n${SHA_A} omo-linux-x64\n`)).ok).toBe(false)
    expect(parseChecksumsRelease(new Uint8Array(0)).ok).toBe(false)
  })

  test("build then parse is the identity", () => {
    const built = buildChecksumsRelease("5.3.1-beta.2", "beta", [["omo-linux-x64", SHA_A], ["omo-windows-x64.exe", SHA_B]])
    const verdict = parseChecksumsRelease(built)
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.version).toBe("5.3.1-beta.2")
      expect(verdict.channel).toBe("beta")
      expect([...verdict.entries.entries()].sort()).toEqual([["omo-linux-x64", SHA_A], ["omo-windows-x64.exe", SHA_B]].sort())
    }
  })
})

describe("compareReleaseVersion ordering (H2 rollback gate)", () => {
  test("orders numerically across fields, releases above their prereleases, and prerelease identifiers per identifier", () => {
    expect(compareReleaseVersion("5.10.0", "5.9.9")).toBeGreaterThan(0)
    expect(compareReleaseVersion("5.0.0", "5.0.0-beta.1")).toBeGreaterThan(0)
    expect(compareReleaseVersion("5.0.0-beta.2", "5.0.0-beta.1")).toBeGreaterThan(0)
    expect(compareReleaseVersion("5.0.0-beta.1", "5.0.0-beta.1")).toBe(0)
    expect(compareReleaseVersion("5.0.0-beta.1", "5.0.0")).toBeLessThan(0)
    expect(compareReleaseVersion("5.1.0", "5.0.99")).toBeGreaterThan(0)
  })
})
