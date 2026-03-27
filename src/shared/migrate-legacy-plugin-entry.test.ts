import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateLegacyPluginEntry } from "./migrate-legacy-plugin-entry"

describe("migrateLegacyPluginEntry", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `omo-migrate-entry-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("#given opencode.json contains oh-my-opencode plugin entry", () => {
    describe("#when migrating the config", () => {
      it("#then replaces oh-my-opencode with oh-my-openagent", () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@latest"] }, null, 2))

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain("oh-my-openagent@latest")
        expect(content).not.toContain("oh-my-opencode")
      })
    })
  })

  describe("#given opencode.json contains bare oh-my-opencode entry", () => {
    describe("#when migrating the config", () => {
      it("#then replaces with oh-my-openagent", () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2))

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain('"oh-my-openagent"')
        expect(content).not.toContain("oh-my-opencode")
      })
    })
  })

  describe("#given opencode.json contains pinned oh-my-opencode version", () => {
    describe("#when migrating the config", () => {
      it("#then preserves the version pin", () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@3.11.0"] }, null, 2))

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain("oh-my-openagent@3.11.0")
      })
    })
  })

  describe("#given opencode.json already uses oh-my-openagent", () => {
    describe("#when checking for migration", () => {
      it("#then returns false and does not modify the file", () => {
        const configPath = join(testDir, "opencode.json")
        const original = JSON.stringify({ plugin: ["oh-my-openagent@latest"] }, null, 2)
        writeFileSync(configPath, original)

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(false)
        expect(readFileSync(configPath, "utf-8")).toBe(original)
      })
    })
  })

  describe("#given config file does not exist", () => {
    describe("#when attempting migration", () => {
      it("#then returns false", () => {
        const result = migrateLegacyPluginEntry(join(testDir, "nonexistent.json"))

        expect(result).toBe(false)
      })
    })
  })
})
