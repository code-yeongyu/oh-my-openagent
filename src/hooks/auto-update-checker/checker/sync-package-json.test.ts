import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginEntryInfo } from "./plugin-entry"

const TEST_CACHE_DIR = join(import.meta.dir, "__test-sync-cache__")

mock.module("../constants", () => ({
  CACHE_DIR: TEST_CACHE_DIR,
  PACKAGE_NAME: "oh-my-opencode",
  NPM_REGISTRY_URL: "https://registry.npmjs.org/-/package/oh-my-opencode/dist-tags",
  NPM_FETCH_TIMEOUT: 5000,
  VERSION_FILE: join(TEST_CACHE_DIR, "version"),
  USER_CONFIG_DIR: "/tmp/opencode-config",
  USER_OPENCODE_CONFIG: "/tmp/opencode-config/opencode.json",
  USER_OPENCODE_CONFIG_JSONC: "/tmp/opencode-config/opencode.jsonc",
  INSTALLED_PACKAGE_JSON: join(TEST_CACHE_DIR, "node_modules", "oh-my-opencode", "package.json"),
  getWindowsAppdataDir: () => null,
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

        const result = syncCachePackageJsonToIntent(pluginInfo)

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

        const result = syncCachePackageJsonToIntent(pluginInfo)

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

        const result = syncCachePackageJsonToIntent(pluginInfo)

        expect(result).toBe(true)
        expect(readCachePackageJsonVersion()).toBe("latest")
      })
    })
  })

  describe("#given cache package.json already matches intent", () => {
    it("#then returns false without modifying package.json", async () => {
      resetTestCache("latest")
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result).toBe(false)
      expect(readCachePackageJsonVersion()).toBe("latest")
    })
  })

  describe("#given cache package.json does not exist", () => {
    it("#then returns false", async () => {
      cleanupTestCache()
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result).toBe(false)
    })
  })

  describe("#given plugin not in cache package.json dependencies", () => {
    it("#then returns false", async () => {
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

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result).toBe(false)
    })
  })

  describe("#given user explicitly changed from one semver to another", () => {
    it("#then updates package.json to new version", async () => {
      resetTestCache("3.9.0")
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@3.10.0",
        isPinned: true,
        pinnedVersion: "3.10.0",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result).toBe(true)
      expect(readCachePackageJsonVersion()).toBe("3.10.0")
    })
  })
})
