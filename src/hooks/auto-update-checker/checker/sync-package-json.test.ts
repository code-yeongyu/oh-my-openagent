import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginEntryInfo } from "./plugin-entry"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-sync-cache__")

mock.module("../constants", () => ({
  CACHE_DIR: TEST_CACHE_DIR,
  PACKAGE_NAME: "oh-my-opencode",
}))

mock.module("../../../shared/logger", () => ({
  log: () => {},
}))

function resetTestCache(currentVersion = "3.10.0"): void {
  if (existsSync(TEST_CACHE_DIR)) {
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
  }

  mkdirSync(TEST_CACHE_DIR, { recursive: true })
  writeFileSync(
    join(TEST_CACHE_DIR, "package.json"),
    JSON.stringify({ dependencies: { "oh-my-opencode": currentVersion, other: "1.0.0" } }, null, 2)
  )
}

function cleanupTestCache(): void {
  if (existsSync(TEST_CACHE_DIR)) {
    rmSync(TEST_CACHE_DIR, { recursive: true, force: true })
  }
}

function readCachePackageJsonVersion(): string | undefined {
  const content = readFileSync(join(TEST_CACHE_DIR, "package.json"), "utf-8")
  const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
  return pkg.dependencies?.["oh-my-opencode"]
}

describe("syncCachePackageJsonToIntent", () => {
  beforeEach(() => {
    resetTestCache()
  })

  afterEach(() => {
    cleanupTestCache()
  })

  describe("#given cache package.json with pinned semver version", () => {
    describe("#when opencode.json intent is latest tag", () => {
      it("#then updates package.json to use latest", async () => {
        const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

        const pluginInfo: PluginEntryInfo = {
          entry: "oh-my-opencode@latest",
          isPinned: false,
          pinnedVersion: "latest",
          configPath: "/tmp/opencode.json",
        }

        //#when
        const result = syncCachePackageJsonToIntent(pluginInfo)

        //#then
        expect(result).toBe(true)
        expect(readCachePackageJsonVersion()).toBe("latest")
      })
    })

    describe("#when opencode.json intent is next tag", () => {
      it("#then updates package.json to use next", async () => {
        const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

        const pluginInfo: PluginEntryInfo = {
          entry: "oh-my-opencode@next",
          isPinned: false,
          pinnedVersion: "next",
          configPath: "/tmp/opencode.json",
        }

        //#when
        const result = syncCachePackageJsonToIntent(pluginInfo)

        //#then
        expect(result).toBe(true)
        expect(readCachePackageJsonVersion()).toBe("next")
      })
    })

    describe("#when opencode.json has no version (implies latest)", () => {
      it("#then updates package.json to use latest", async () => {
        const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

        const pluginInfo: PluginEntryInfo = {
          entry: "oh-my-opencode",
          isPinned: false,
          pinnedVersion: null,
          configPath: "/tmp/opencode.json",
        }

        //#when
        const result = syncCachePackageJsonToIntent(pluginInfo)

        //#then
        expect(result).toBe(true)
        expect(readCachePackageJsonVersion()).toBe("latest")
      })
    })
  })

  describe("#given cache package.json already matches intent", () => {
    it("#then returns false without modifying package.json", async () => {
      //#given
      resetTestCache("latest")
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      //#when
      const result = syncCachePackageJsonToIntent(pluginInfo)

      //#then
      expect(result).toBe(false)
      expect(readCachePackageJsonVersion()).toBe("latest")
    })
  })

  describe("#given cache package.json does not exist", () => {
    it("#then returns false", async () => {
      //#given
      cleanupTestCache()
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      //#when
      const result = syncCachePackageJsonToIntent(pluginInfo)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given plugin not in cache package.json dependencies", () => {
    it("#then returns false", async () => {
      //#given
      cleanupTestCache()
      mkdirSync(TEST_CACHE_DIR, { recursive: true })
      writeFileSync(
        join(TEST_CACHE_DIR, "package.json"),
        JSON.stringify({ dependencies: { other: "1.0.0" } }, null, 2)
      )

      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      //#when
      const result = syncCachePackageJsonToIntent(pluginInfo)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given user explicitly pinned a different semver", () => {
    it("#then updates package.json to new version", async () => {
      //#given
      resetTestCache("3.9.0")
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@3.10.0",
        isPinned: true,
        pinnedVersion: "3.10.0",
        configPath: "/tmp/opencode.json",
      }

      //#when
      const result = syncCachePackageJsonToIntent(pluginInfo)

      //#then
      expect(result).toBe(true)
      expect(readCachePackageJsonVersion()).toBe("3.10.0")
    })
  })

  describe("#given other dependencies exist in cache package.json", () => {
    it("#then preserves other dependencies while updating the plugin", async () => {
      //#given
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      //#when
      syncCachePackageJsonToIntent(pluginInfo)

      //#then
      const content = readFileSync(join(TEST_CACHE_DIR, "package.json"), "utf-8")
      const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
      expect(pkg.dependencies?.other).toBe("1.0.0")
      expect(pkg.dependencies?.["oh-my-opencode"]).toBe("latest")
    })
  })
})
