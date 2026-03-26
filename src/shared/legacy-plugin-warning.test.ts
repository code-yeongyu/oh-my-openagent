import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkForLegacyPluginEntry } from "./legacy-plugin-warning"

describe("checkForLegacyPluginEntry", () => {
  let testConfigDir = ""
  let originalXdgConfigHome: string | undefined
  let originalOpenCodeConfigDir: string | undefined

  beforeEach(() => {
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    originalOpenCodeConfigDir = process.env.OPENCODE_CONFIG_DIR
    testConfigDir = join(tmpdir(), `omo-legacy-check-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(testConfigDir, "opencode"), { recursive: true })
    process.env.XDG_CONFIG_HOME = testConfigDir
    delete process.env.OPENCODE_CONFIG_DIR
  })

  afterEach(() => {
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    }

    if (originalOpenCodeConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR
    } else {
      process.env.OPENCODE_CONFIG_DIR = originalOpenCodeConfigDir
    }

    rmSync(testConfigDir, { recursive: true, force: true })
  })

  it("detects a bare legacy plugin entry", () => {
    // given
    writeFileSync(join(testConfigDir, "opencode", "opencode.json"), JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2))

    // when
    const result = checkForLegacyPluginEntry()

    // then
    expect(result.hasLegacyEntry).toBe(true)
    expect(result.hasCanonicalEntry).toBe(false)
    expect(result.legacyEntries).toEqual(["oh-my-opencode"])
  })

  it("detects a version-pinned legacy plugin entry", () => {
    // given
    writeFileSync(join(testConfigDir, "opencode", "opencode.json"), JSON.stringify({ plugin: ["oh-my-opencode@3.10.0"] }, null, 2))

    // when
    const result = checkForLegacyPluginEntry()

    // then
    expect(result.hasLegacyEntry).toBe(true)
    expect(result.hasCanonicalEntry).toBe(false)
    expect(result.legacyEntries).toEqual(["oh-my-opencode@3.10.0"])
  })

  it("does not flag a canonical plugin entry", () => {
    // given
    writeFileSync(join(testConfigDir, "opencode", "opencode.json"), JSON.stringify({ plugin: ["oh-my-openagent"] }, null, 2))

    // when
    const result = checkForLegacyPluginEntry()

    // then
    expect(result.hasLegacyEntry).toBe(false)
    expect(result.hasCanonicalEntry).toBe(true)
    expect(result.legacyEntries).toEqual([])
  })

  it("detects legacy entries in quoted jsonc config", () => {
    // given
    writeFileSync(join(testConfigDir, "opencode", "opencode.jsonc"), '{\n  "plugin": ["oh-my-opencode"]\n}\n')

    // when
    const result = checkForLegacyPluginEntry()

    // then
    expect(result.hasLegacyEntry).toBe(true)
    expect(result.legacyEntries).toEqual(["oh-my-opencode"])
  })

  it("returns no warning data when config is missing", () => {
    // when
    const result = checkForLegacyPluginEntry()

    // then
    expect(result.hasLegacyEntry).toBe(false)
    expect(result.hasCanonicalEntry).toBe(false)
    expect(result.legacyEntries).toEqual([])
  })
})
