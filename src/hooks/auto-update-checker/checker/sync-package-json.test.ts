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

        expect(result.synced).toBe(true)
        expect(result.error).toBeNull()
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

        expect(result.synced).toBe(true)
        expect(result.error).toBeNull()
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

        expect(result.synced).toBe(true)
        expect(result.error).toBeNull()
        expect(readCachePackageJsonVersion()).toBe("latest")
      })
    })
  })

  describe("#given cache package.json already matches intent", () => {
    it("#then returns synced false with no error", async () => {
      resetTestCache("latest")
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(false)
      expect(result.error).toBeNull()
      expect(readCachePackageJsonVersion()).toBe("latest")
    })
  })

  describe("#given cache package.json does not exist", () => {
    it("#then returns file_not_found error", async () => {
      cleanupTestCache()
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(false)
      expect(result.error).toBe("file_not_found")
    })
  })

  describe("#given plugin not in cache package.json dependencies", () => {
    it("#then returns plugin_not_in_deps error", async () => {
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

      expect(result.synced).toBe(false)
      expect(result.error).toBe("plugin_not_in_deps")
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

      expect(result.synced).toBe(true)
      expect(result.error).toBeNull()
      expect(readCachePackageJsonVersion()).toBe("3.10.0")
    })
  })

  describe("#given cache package.json with other dependencies", () => {
    it("#then other dependencies are preserved when updating plugin version", async () => {
      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(true)
      expect(result.error).toBeNull()

      const content = readFileSync(join(TEST_CACHE_DIR, "package.json"), "utf-8")
      const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
      expect(pkg.dependencies?.["other"]).toBe("1.0.0")
    })
  })

  describe("#given malformed JSON in cache package.json", () => {
    it("#then returns parse_error", async () => {
      cleanupTestCache()
      mkdirSync(TEST_CACHE_DIR, { recursive: true })
      writeFileSync(join(TEST_CACHE_DIR, "package.json"), "{ invalid json }")

      const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(false)
      expect(result.error).toBe("parse_error")
    })
  })

  describe("#given write permission denied", () => {
    it("#then returns write_error", async () => {
      cleanupTestCache()
      mkdirSync(TEST_CACHE_DIR, { recursive: true })
      writeFileSync(
        join(TEST_CACHE_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.10.0" } }, null, 2)
      )

      const fs = await import("node:fs")
      const originalWriteFileSync = fs.writeFileSync
      const originalRenameSync = fs.renameSync

      mock.module("node:fs", () => ({
        ...fs,
        writeFileSync: mock(() => {
          throw new Error("EACCES: permission denied")
        }),
        renameSync: fs.renameSync,
      }))

      try {
        const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

        const pluginInfo: PluginEntryInfo = {
          entry: "oh-my-opencode@latest",
          isPinned: false,
          pinnedVersion: "latest",
          configPath: "/tmp/opencode.json",
        }

        const result = syncCachePackageJsonToIntent(pluginInfo)

        expect(result.synced).toBe(false)
        expect(result.error).toBe("write_error")
      } finally {
        mock.module("node:fs", () => ({
          ...fs,
          writeFileSync: originalWriteFileSync,
          renameSync: originalRenameSync,
        }))
      }
    })
  })

  describe("#given rename fails after successful write", () => {
    it("#then returns write_error and cleans up temp file", async () => {
      cleanupTestCache()
      mkdirSync(TEST_CACHE_DIR, { recursive: true })
      writeFileSync(
        join(TEST_CACHE_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.10.0" } }, null, 2)
      )

      const fs = await import("node:fs")
      const originalWriteFileSync = fs.writeFileSync
      const originalRenameSync = fs.renameSync

      let tempFilePath: string | null = null

      mock.module("node:fs", () => ({
        ...fs,
        writeFileSync: mock((path: string, data: string) => {
          tempFilePath = path
          return originalWriteFileSync(path, data)
        }),
        renameSync: mock(() => {
          throw new Error("EXDEV: cross-device link not permitted")
        }),
      }))

      try {
        const { syncCachePackageJsonToIntent } = await import("./sync-package-json")

        const pluginInfo: PluginEntryInfo = {
          entry: "oh-my-opencode@latest",
          isPinned: false,
          pinnedVersion: "latest",
          configPath: "/tmp/opencode.json",
        }

        const result = syncCachePackageJsonToIntent(pluginInfo)

        expect(result.synced).toBe(false)
        expect(result.error).toBe("write_error")
        expect(tempFilePath).not.toBeNull()
        expect(existsSync(tempFilePath!)).toBe(false)
      } finally {
        mock.module("node:fs", () => ({
          ...fs,
          writeFileSync: originalWriteFileSync,
          renameSync: originalRenameSync,
        }))
      }
    })
  })
})
