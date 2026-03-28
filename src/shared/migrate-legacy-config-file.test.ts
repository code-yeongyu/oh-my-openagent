import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { migrateLegacyConfigFile } from "./migrate-legacy-config-file"

describe("migrateLegacyConfigFile", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `omo-migrate-config-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe("#given oh-my-opencode.jsonc exists but oh-my-openagent.jsonc does not", () => {
    describe("#when migrating the config file", () => {
      it("#then copies to oh-my-openagent.jsonc", () => {
        const legacyPath = join(testDir, "oh-my-opencode.jsonc")
        writeFileSync(legacyPath, '{ "agents": {} }')

        const result = migrateLegacyConfigFile(legacyPath)

        expect(result).toBe(true)
        expect(existsSync(join(testDir, "oh-my-openagent.jsonc"))).toBe(true)
        expect(readFileSync(join(testDir, "oh-my-openagent.jsonc"), "utf-8")).toBe('{ "agents": {} }')
      })
    })
  })

  describe("#given oh-my-opencode.json exists but oh-my-openagent.json does not", () => {
    describe("#when migrating the config file", () => {
      it("#then copies to oh-my-openagent.json", () => {
        const legacyPath = join(testDir, "oh-my-opencode.json")
        writeFileSync(legacyPath, '{ "agents": {} }')

        const result = migrateLegacyConfigFile(legacyPath)

        expect(result).toBe(true)
        expect(existsSync(join(testDir, "oh-my-openagent.json"))).toBe(true)
      })
    })
  })

  describe("#given oh-my-openagent.jsonc already exists", () => {
    describe("#when attempting migration", () => {
      it("#then returns false and does not overwrite", () => {
        const legacyPath = join(testDir, "oh-my-opencode.jsonc")
        const canonicalPath = join(testDir, "oh-my-openagent.jsonc")
        writeFileSync(legacyPath, '{ "old": true }')
        writeFileSync(canonicalPath, '{ "new": true }')

        const result = migrateLegacyConfigFile(legacyPath)

        expect(result).toBe(false)
        expect(readFileSync(canonicalPath, "utf-8")).toBe('{ "new": true }')
      })
    })
  })

  describe("#given the file does not exist", () => {
    describe("#when attempting migration", () => {
      it("#then returns false", () => {
        const result = migrateLegacyConfigFile(join(testDir, "oh-my-opencode.jsonc"))

        expect(result).toBe(false)
      })
    })
  })

  describe("#given the file is not a legacy config file", () => {
    describe("#when attempting migration", () => {
      it("#then returns false", () => {
        const nonLegacyPath = join(testDir, "something-else.jsonc")
        writeFileSync(nonLegacyPath, "{}")

        const result = migrateLegacyConfigFile(nonLegacyPath)

        expect(result).toBe(false)
      })
    })
  })
})
