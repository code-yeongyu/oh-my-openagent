import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { autoMigrateLegacyPluginEntry } from "./auto-migrate"

describe("autoMigrateLegacyPluginEntry", () => {
  let testConfigDir = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-legacy-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testConfigDir, { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
    delete process.env.OPENCODE_CONFIG_DIR
  })

  describe("#given opencode.json has a bare legacy plugin entry", () => {
    it("#then replaces oh-my-opencode with oh-my-openagent", () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n",
      )

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(true)
      expect(result.from).toBe("oh-my-opencode")
      expect(result.to).toBe("oh-my-openagent")
      const saved = JSON.parse(readFileSync(join(testConfigDir, "opencode.json"), "utf-8"))
      expect(saved.plugin).toEqual(["oh-my-openagent"])
    })
  })

  describe("#given opencode.json has a version-pinned legacy entry", () => {
    it("#then preserves the version suffix", () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-opencode@3.10.0"] }, null, 2) + "\n",
      )

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(true)
      expect(result.from).toBe("oh-my-opencode@3.10.0")
      expect(result.to).toBe("oh-my-openagent@3.10.0")
      const saved = JSON.parse(readFileSync(join(testConfigDir, "opencode.json"), "utf-8"))
      expect(saved.plugin).toEqual(["oh-my-openagent@3.10.0"])
    })
  })

  describe("#given both canonical and legacy entries exist", () => {
    it("#then removes legacy entry and keeps canonical", () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n",
      )

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(true)
      const saved = JSON.parse(readFileSync(join(testConfigDir, "opencode.json"), "utf-8"))
      expect(saved.plugin).toEqual(["oh-my-openagent"])
    })
  })

  describe("#given no config file exists", () => {
    it("#then returns migrated false", () => {
      // given - empty dir

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(false)
      expect(result.from).toBeNull()
    })
  })

  describe("#given opencode.jsonc has comments and a legacy entry", () => {
    it("#then preserves comments and replaces entry", () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.jsonc"),
        '{\n  // my config\n  "plugin": ["oh-my-opencode"]\n}\n',
      )

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(true)
      const content = readFileSync(join(testConfigDir, "opencode.jsonc"), "utf-8")
      expect(content).toContain("// my config")
      expect(content).toContain("oh-my-openagent")
      expect(content).not.toContain("oh-my-opencode")
    })
  })

  describe("#given only canonical entry exists", () => {
    it("#then returns migrated false and leaves file untouched", () => {
      // given
      const original = JSON.stringify({ plugin: ["oh-my-openagent"] }, null, 2) + "\n"
      writeFileSync(join(testConfigDir, "opencode.json"), original)

      // when
      const result = autoMigrateLegacyPluginEntry()

      // then
      expect(result.migrated).toBe(false)
      const content = readFileSync(join(testConfigDir, "opencode.json"), "utf-8")
      expect(content).toBe(original)
    })
  })
})
