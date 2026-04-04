import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mockMigrateLegacyPluginEntry = mock(() => true)

mock.module("./plugin-entry-migrator", () => ({
  migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
}))

async function importFreshAutoMigrateModule(): Promise<typeof import("./auto-migrate")> {
  return import(`./auto-migrate?test=${Date.now()}-${Math.random()}`)
}

describe("autoMigrateLegacyPluginEntry", () => {
  let testConfigDir = ""

  beforeEach(() => {
    testConfigDir = join(tmpdir(), `omo-legacy-migrate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testConfigDir, { recursive: true })
    mockMigrateLegacyPluginEntry.mockReset()
    mockMigrateLegacyPluginEntry.mockReturnValue(true)
  })

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true })
  })

  describe("#given opencode.json has a bare legacy plugin entry", () => {
    it("#then replaces oh-my-opencode with oh-my-openagent", async () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-opencode"] }, null, 2) + "\n",
      )

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(true)
      expect(result.from).toBe("oh-my-opencode")
      expect(result.to).toBe("oh-my-openagent")
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith(join(testConfigDir, "opencode.json"))
    })
  })

  describe("#given opencode.json has a version-pinned legacy entry", () => {
    it("#then preserves the version suffix", async () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-opencode@3.10.0"] }, null, 2) + "\n",
      )

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(true)
      expect(result.from).toBe("oh-my-opencode@3.10.0")
      expect(result.to).toBe("oh-my-openagent@3.10.0")
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith(join(testConfigDir, "opencode.json"))
    })
  })

  describe("#given both canonical and legacy entries exist", () => {
    it("#then removes legacy entry and keeps canonical", async () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.json"),
        JSON.stringify({ plugin: ["oh-my-openagent", "oh-my-opencode"] }, null, 2) + "\n",
      )

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(true)
      expect(result.to).toBe("oh-my-openagent")
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith(join(testConfigDir, "opencode.json"))
    })
  })

  describe("#given no config file exists", () => {
    it("#then returns migrated false", async () => {
      // given - empty dir
      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(false)
      expect(result.from).toBeNull()
      expect(mockMigrateLegacyPluginEntry).not.toHaveBeenCalled()
    })
  })

  describe("#given opencode.jsonc has comments and a legacy entry", () => {
    it("#then preserves comments and replaces entry", async () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.jsonc"),
        '{\n  // my config\n  "plugin": ["oh-my-opencode"]\n}\n',
      )

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(true)
      expect(result.to).toBe("oh-my-openagent")
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith(join(testConfigDir, "opencode.jsonc"))
    })
  })

  describe("#given opencode.jsonc has a nested plugin key before the root plugin array", () => {
    it("#then migrates only the root plugin entry", async () => {
      // given
      writeFileSync(
        join(testConfigDir, "opencode.jsonc"),
        `{
  "nested": {
    "plugin": ["oh-my-opencode"]
  },
  "plugin": ["oh-my-opencode@latest"]
}
`,
      )

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(true)
      expect(result.from).toBe("oh-my-opencode@latest")
      expect(result.to).toBe("oh-my-openagent@latest")
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith(join(testConfigDir, "opencode.jsonc"))
    })
  })

  describe("#given only canonical entry exists", () => {
    it("#then returns migrated false and leaves file untouched", async () => {
      // given
      const original = JSON.stringify({ plugin: ["oh-my-openagent"] }, null, 2) + "\n"
      writeFileSync(join(testConfigDir, "opencode.json"), original)

      const { autoMigrateLegacyPluginEntry } = await importFreshAutoMigrateModule()

      // when
      const result = autoMigrateLegacyPluginEntry(testConfigDir)

      // then
      expect(result.migrated).toBe(false)
      expect(mockMigrateLegacyPluginEntry).not.toHaveBeenCalled()
    })
  })
})
