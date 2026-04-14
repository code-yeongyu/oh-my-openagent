import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginEntryInfo } from "../auto-update-checker/checker/plugin-entry"
import { CACHE_DIR } from "../auto-update-checker/constants"

const CACHE_PACKAGES_DIR = CACHE_DIR
const CACHE_PACKAGE_JSON_PATH = join(CACHE_PACKAGES_DIR, "package.json")
const ORIGINAL_CACHE_PACKAGE_JSON = existsSync(CACHE_PACKAGE_JSON_PATH)
  ? readFileSync(CACHE_PACKAGE_JSON_PATH, "utf-8")
  : null

let importCounter = 0

async function importFreshSyncPackageJsonModule(): Promise<typeof import("../auto-update-checker/checker/sync-package-json")> {
  mock.module("../../shared/logger", () => ({
    log: () => {},
  }))

  return import(`../auto-update-checker/checker/sync-package-json?test=${importCounter++}`)
}

function resetTestCache(currentVersion = "3.10.0"): void {
  mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
  writeFileSync(
    CACHE_PACKAGE_JSON_PATH,
    JSON.stringify({ dependencies: { "oh-my-opencode": currentVersion, other: "1.0.0" } }, null, 2)
  )
}

function cleanupTestCache(): void {
  if (existsSync(CACHE_PACKAGE_JSON_PATH)) {
    rmSync(CACHE_PACKAGE_JSON_PATH, { force: true })
  }
}

function readCachePackageJsonVersion(): string | undefined {
  const content = readFileSync(CACHE_PACKAGE_JSON_PATH, "utf-8")
  const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
  return pkg.dependencies?.["oh-my-opencode"]
}

describe("syncCachePackageJsonToIntent", () => {
  beforeEach(() => {
    resetTestCache()
  })

  afterEach(() => {
    mock.restore()
    cleanupTestCache()
  })

  describe("#given cache package.json with pinned semver version", () => {
    describe("#when opencode.json intent is latest tag", () => {
      it("#then updates package.json to use latest", async () => {
        const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
        const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
        const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
    it("#then creates cache package.json with the plugin dependency", async () => {
      cleanupTestCache()
      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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

  describe("#given plugin not in cache package.json dependencies", () => {
    it("#then adds the plugin dependency and preserves existing dependencies", async () => {
      cleanupTestCache()
      mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
      writeFileSync(
        join(CACHE_PACKAGES_DIR, "package.json"),
        JSON.stringify({ dependencies: { other: "1.0.0" } }, null, 2)
      )

      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(true)
      expect(result.error).toBeNull()

        const content = readFileSync(join(CACHE_PACKAGES_DIR, "package.json"), "utf-8")
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
        expect(pkg.dependencies?.["oh-my-opencode"]).toBe("latest")
        expect(pkg.dependencies?.other).toBe("1.0.0")
    })
  })

  describe("#given user explicitly changed from one semver to another", () => {
    it("#then updates package.json to new version", async () => {
      resetTestCache("3.9.0")
      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

      const pluginInfo: PluginEntryInfo = {
        entry: "oh-my-opencode@latest",
        isPinned: false,
        pinnedVersion: "latest",
        configPath: "/tmp/opencode.json",
      }

      const result = syncCachePackageJsonToIntent(pluginInfo)

      expect(result.synced).toBe(true)
      expect(result.error).toBeNull()

        const content = readFileSync(join(CACHE_PACKAGES_DIR, "package.json"), "utf-8")
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string> }
        expect(pkg.dependencies?.["other"]).toBe("1.0.0")
    })
  })

  describe("#given malformed JSON in cache package.json", () => {
    it("#then returns parse_error", async () => {
      cleanupTestCache()
      mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
      writeFileSync(join(CACHE_PACKAGES_DIR, "package.json"), "{ invalid json }")

      const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
      mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
      writeFileSync(
        join(CACHE_PACKAGES_DIR, "package.json"),
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
        const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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
      mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
      writeFileSync(
        join(CACHE_PACKAGES_DIR, "package.json"),
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
        const { syncCachePackageJsonToIntent } = await importFreshSyncPackageJsonModule()

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

afterAll(() => {
  if (ORIGINAL_CACHE_PACKAGE_JSON === null) {
    cleanupTestCache()
  } else {
    mkdirSync(CACHE_PACKAGES_DIR, { recursive: true })
    writeFileSync(CACHE_PACKAGE_JSON_PATH, ORIGINAL_CACHE_PACKAGE_JSON)
  }
  mock.restore()
})
