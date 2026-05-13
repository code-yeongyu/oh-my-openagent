/// <reference path="../../../bun-test.d.ts" />

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function importFreshMigrationModule(): Promise<typeof import("../migrate-legacy-plugin-entry")> {
  return import(`../migrate-legacy-plugin-entry?test=${Date.now()}-${Math.random()}`)
}

afterAll(() => {
  mock.restore()
})

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
      it("#then replaces oh-my-opencode with oh-my-openagent", async () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@latest"] }, null, 2))
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

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
      it("#then replaces with oh-my-openagent", async () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2))
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain('"oh-my-openagent"')
        expect(content).not.toContain("oh-my-opencode")
      })
    })
  })

  describe("#given renaming the temp file fails after writing the migrated config", () => {
    describe("#when migrating the config", () => {
      it("#then keeps the original config untouched and writes the migrated content to a sibling temp file", async () => {
        const configPath = join(testDir, "opencode.json")
        const originalContent = JSON.stringify({ plugin: ["oh-my-opencode@latest"] }, null, 2)
        const tempPath = `${configPath}.tmp`
        writeFileSync(configPath, originalContent)

        const fs = await import("node:fs")
        const originalRenameSync = fs.renameSync

        mock.module("node:fs", () => ({
          ...fs,
          renameSync: () => {
            throw new Error("simulated rename failure")
          },
        }))

        try {
          const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

          const result = migrateLegacyPluginEntry(configPath)

          expect(result).toBe(false)
          expect(readFileSync(configPath, "utf-8")).toBe(originalContent)
          expect(readFileSync(tempPath, "utf-8")).toContain("oh-my-openagent@latest")
          expect(readFileSync(tempPath, "utf-8")).not.toContain("oh-my-opencode")
        } finally {
          mock.module("node:fs", () => ({
            ...fs,
            renameSync: originalRenameSync,
          }))
        }
      })
    })
  })

  describe("#given opencode.json contains pinned oh-my-opencode version", () => {
    describe("#when migrating the config", () => {
      it("#then preserves the version pin", async () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-opencode@3.11.0"] }, null, 2))
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain("oh-my-openagent@3.11.0")
      })
    })
  })

  describe("#given opencode.json already uses oh-my-openagent", () => {
    describe("#when checking for migration", () => {
      it("#then returns false and does not modify the file", async () => {
        const configPath = join(testDir, "opencode.json")
        const original = JSON.stringify({ plugin: ["oh-my-openagent@latest"] }, null, 2)
        writeFileSync(configPath, original)
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(false)
        expect(readFileSync(configPath, "utf-8")).toBe(original)
      })
    })
  })

  describe("#given plugin entries contain both canonical and legacy values", () => {
    describe("#when migrating the config", () => {
      it("#then removes the legacy entry instead of duplicating the canonical one", async () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(configPath, JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2))
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const saved = JSON.parse(readFileSync(configPath, "utf-8")) as { plugin: string[] }
        expect(saved.plugin).toEqual(["oh-my-openagent"])
      })
    })
  })

  describe("#given unrelated strings contain the legacy package name", () => {
    describe("#when migrating the config", () => {
      it("#then rewrites only plugin entries and preserves unrelated fields", async () => {
        const configPath = join(testDir, "opencode.json")
        writeFileSync(
          configPath,
          JSON.stringify(
            {
              plugin: ["oh-my-opencode"],
              notes: "keep oh-my-opencode in this text field",
              paths: ["/tmp/oh-my-opencode/cache"],
            },
            null,
            2,
          ),
        )
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const saved = JSON.parse(readFileSync(configPath, "utf-8")) as {
          plugin: string[]
          notes: string
          paths: string[]
        }
        expect(saved.plugin).toEqual(["oh-my-openagent"])
        expect(saved.notes).toBe("keep oh-my-opencode in this text field")
        expect(saved.paths).toEqual(["/tmp/oh-my-opencode/cache"])
      })
    })
  })

  describe("#given opencode.jsonc contains a nested plugin key before the top-level plugin array", () => {
    describe("#when migrating the config", () => {
      it("#then rewrites only the top-level plugin array", async () => {
        const configPath = join(testDir, "opencode.jsonc")
        writeFileSync(
          configPath,
          `{
  "nested": {
    "plugin": ["oh-my-opencode"]
  },
  "plugin": ["oh-my-opencode@latest"]
}
`,
        )
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()

        const result = migrateLegacyPluginEntry(configPath)

        expect(result).toBe(true)
        const content = readFileSync(configPath, "utf-8")
        expect(content).toContain(`"nested": {
    "plugin": ["oh-my-opencode"]
  }`)
        expect(content).toContain(`"plugin": [
    "oh-my-openagent@latest"
  ]`)
      })
    })
  })

  describe("#given config file does not exist", () => {
    describe("#when attempting migration", () => {
      it("#then returns false", async () => {
        const { migrateLegacyPluginEntry } = await importFreshMigrationModule()
        const result = migrateLegacyPluginEntry(join(testDir, "nonexistent.json"))

        expect(result).toBe(false)
      })
    })
  })
})