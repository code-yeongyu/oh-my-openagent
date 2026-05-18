import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { checkForLegacyPluginEntry } = await import(
  new URL("./legacy-plugin-warning.ts?real-legacy-plugin-warning-test", import.meta.url).href
)

function createTestConfigDir(): string {
  return mkdtempSync(join(tmpdir(), "omo-legacy-check-"))
}

function cleanupTestConfigDir(testConfigDir: string): void {
  rmSync(testConfigDir, { recursive: true, force: true })
}

describe("checkForLegacyPluginEntry", () => {
  it("detects a bare legacy plugin entry", () => {
    const testConfigDir = createTestConfigDir()

    try {
      // given
      writeFileSync(join(testConfigDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2))

      // when
      const result = checkForLegacyPluginEntry(testConfigDir)

      // then
      expect(result.hasLegacyEntry).toBe(true)
      expect(result.hasCanonicalEntry).toBe(false)
      expect(result.legacyEntries).toEqual(["oh-my-opencode"])
      expect(result.configPath).toBe(join(testConfigDir, "opencode.json"))
    } finally {
      cleanupTestConfigDir(testConfigDir)
    }
  })

  it("detects a version-pinned legacy plugin entry", () => {
    const testConfigDir = createTestConfigDir()

    try {
      // given
      writeFileSync(join(testConfigDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-opencode@3.10.0"] }, null, 2))

      // when
      const result = checkForLegacyPluginEntry(testConfigDir)

      // then
      expect(result.hasLegacyEntry).toBe(true)
      expect(result.hasCanonicalEntry).toBe(false)
      expect(result.legacyEntries).toEqual(["oh-my-opencode@3.10.0"])
    } finally {
      cleanupTestConfigDir(testConfigDir)
    }
  })

  it("does not flag a canonical plugin entry", () => {
    const testConfigDir = createTestConfigDir()

    try {
      // given
      writeFileSync(join(testConfigDir, "opencode.json"), JSON.stringify({ plugin: ["oh-my-openagent"] }, null, 2))

      // when
      const result = checkForLegacyPluginEntry(testConfigDir)

      // then
      expect(result.hasLegacyEntry).toBe(false)
      expect(result.hasCanonicalEntry).toBe(true)
      expect(result.legacyEntries).toEqual([])
    } finally {
      cleanupTestConfigDir(testConfigDir)
    }
  })

  it("detects legacy entries in quoted jsonc config", () => {
    const testConfigDir = createTestConfigDir()

    try {
      // given
      writeFileSync(join(testConfigDir, "opencode.jsonc"), '{\n  "plugin": ["oh-my-opencode"]\n}\n')

      // when
      const result = checkForLegacyPluginEntry(testConfigDir)

      // then
      expect(result.hasLegacyEntry).toBe(true)
      expect(result.legacyEntries).toEqual(["oh-my-opencode"])
    } finally {
      cleanupTestConfigDir(testConfigDir)
    }
  })

  it("returns no warning data when config is missing", () => {
    const testConfigDir = createTestConfigDir()

    try {
      // when
      const result = checkForLegacyPluginEntry(testConfigDir)

      // then
      expect(result.hasLegacyEntry).toBe(false)
      expect(result.hasCanonicalEntry).toBe(false)
      expect(result.legacyEntries).toEqual([])
      expect(result.configPath).toBeNull()
    } finally {
      cleanupTestConfigDir(testConfigDir)
    }
  })
})
