import { describe, expect, it } from "bun:test"
import {
  checkVersionCompatibility,
  extractVersionFromPluginEntry,
} from "./version-compatibility"

describe("checkVersionCompatibility", () => {
  it("allows fresh install when no current version", () => {
    const result = checkVersionCompatibility(null, "3.15.0")
    expect(result.canUpgrade).toBe(true)
    expect(result.isDowngrade).toBe(false)
    expect(result.requiresMigration).toBe(false)
  })

  it("detects same version as already installed", () => {
    const result = checkVersionCompatibility("3.15.0", "3.15.0")
    expect(result.canUpgrade).toBe(true)
    expect(result.reason).toContain("already installed")
  })

  it("blocks downgrade from higher to lower version", () => {
    const result = checkVersionCompatibility("3.15.0", "3.14.0")
    expect(result.canUpgrade).toBe(false)
    expect(result.isDowngrade).toBe(true)
    expect(result.reason).toContain("Downgrade")
  })

  it("allows patch version upgrade", () => {
    const result = checkVersionCompatibility("3.15.0", "3.15.1")
    expect(result.canUpgrade).toBe(true)
    expect(result.isMajorBump).toBe(false)
    expect(result.requiresMigration).toBe(false)
  })

  it("allows minor version upgrade", () => {
    const result = checkVersionCompatibility("3.15.0", "3.16.0")
    expect(result.canUpgrade).toBe(true)
    expect(result.isMajorBump).toBe(false)
    expect(result.requiresMigration).toBe(false)
  })

  it("detects major version bump requiring migration", () => {
    const result = checkVersionCompatibility("3.15.0", "4.0.0")
    expect(result.canUpgrade).toBe(true)
    expect(result.isMajorBump).toBe(true)
    expect(result.requiresMigration).toBe(true)
    expect(result.reason).toContain("Major version upgrade")
  })

  it("handles v prefix in versions", () => {
    const result = checkVersionCompatibility("v3.15.0", "v3.16.0")
    expect(result.canUpgrade).toBe(true)
    expect(result.isDowngrade).toBe(false)
  })

  it("handles mixed v prefix", () => {
    const result = checkVersionCompatibility("3.15.0", "v3.16.0")
    expect(result.canUpgrade).toBe(true)
  })
})

describe("extractVersionFromPluginEntry", () => {
  it("extracts version from canonical plugin entry", () => {
    const version = extractVersionFromPluginEntry("oh-my-openagent@3.15.0")
    expect(version).toBe("3.15.0")
  })

  it("extracts version from legacy plugin entry", () => {
    const version = extractVersionFromPluginEntry("oh-my-opencode@3.14.0")
    expect(version).toBe("3.14.0")
  })

  it("returns null for bare plugin entry", () => {
    const version = extractVersionFromPluginEntry("oh-my-openagent")
    expect(version).toBeNull()
  })

  it("handles prerelease versions", () => {
    const version = extractVersionFromPluginEntry("oh-my-openagent@3.16.0-beta.1")
    expect(version).toBe("3.16.0-beta.1")
  })
})
