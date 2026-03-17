import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type PluginEntry = {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
}

type ToastMessageGetter = (isUpdate: boolean, version?: string) => string

function createPluginEntry(overrides?: Partial<PluginEntry>): PluginEntry {
  return {
    entry: "oh-my-opencode@3.4.0",
    isPinned: false,
    pinnedVersion: null,
    configPath: "/test/opencode.json",
    ...overrides,
  }
}

const TEST_DIR = join(import.meta.dir, "__test-workspace-resolution__")
const TEST_CACHE_DIR = join(TEST_DIR, "cache")
const TEST_CONFIG_DIR = join(TEST_DIR, "config")

const mockFindPluginEntry = mock((_directory: string): PluginEntry | null => createPluginEntry())
const mockGetCachedVersion = mock((): string | null => "3.4.0")
const mockGetLatestVersion = mock(async (): Promise<string | null> => "3.5.0")
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockShowUpdateAvailableToast = mock(
  async (_ctx: PluginInput, _latestVersion: string, _getToastMessage: ToastMessageGetter): Promise<void> => {}
)
const mockShowAutoUpdatedToast = mock(
  async (_ctx: PluginInput, _fromVersion: string, _toVersion: string): Promise<void> => {}
)
const mockSyncCachePackageJsonToIntent = mock(() => ({ synced: true, error: null }))

const mockRunBunInstallWithDetails = mock(
  async (opts?: { outputMode?: string; workspaceDir?: string }) => {
    return { success: true }
  }
)

mock.module("../checker", () => ({
  findPluginEntry: mockFindPluginEntry,
  getCachedVersion: mockGetCachedVersion,
  getLatestVersion: mockGetLatestVersion,
  revertPinnedVersion: mock(() => false),
  syncCachePackageJsonToIntent: mockSyncCachePackageJsonToIntent,
}))
mock.module("../version-channel", () => ({ extractChannel: mockExtractChannel }))
mock.module("../cache", () => ({ invalidatePackage: mockInvalidatePackage }))
mock.module("../../../cli/config-manager", () => ({
  runBunInstallWithDetails: mockRunBunInstallWithDetails,
}))
mock.module("./update-toasts", () => ({
  showUpdateAvailableToast: mockShowUpdateAvailableToast,
  showAutoUpdatedToast: mockShowAutoUpdatedToast,
}))
mock.module("../../../shared/logger", () => ({ log: () => {} }))
mock.module("../../../shared", () => ({
  getOpenCodeCacheDir: () => TEST_CACHE_DIR,
  getOpenCodeConfigPaths: () => ({
    configDir: TEST_CONFIG_DIR,
    configJson: join(TEST_CONFIG_DIR, "opencode.json"),
    configJsonc: join(TEST_CONFIG_DIR, "opencode.jsonc"),
    packageJson: join(TEST_CONFIG_DIR, "package.json"),
    omoConfig: join(TEST_CONFIG_DIR, "oh-my-opencode.json"),
  }),
  getOpenCodeConfigDir: () => TEST_CONFIG_DIR,
}))

// Mock constants BEFORE importing the module
const ORIGINAL_PACKAGE_NAME = "oh-my-opencode"
mock.module("../constants", () => ({
  PACKAGE_NAME: ORIGINAL_PACKAGE_NAME,
  CACHE_DIR: TEST_CACHE_DIR,
  USER_CONFIG_DIR: TEST_CONFIG_DIR,
}))

// Need to mock getOpenCodeCacheDir and getOpenCodeConfigPaths before importing the module
mock.module("../../../shared/data-path", () => ({
  getDataDir: () => join(TEST_DIR, "data"),
  getOpenCodeStorageDir: () => join(TEST_DIR, "data", "opencode", "storage"),
  getCacheDir: () => TEST_DIR,
  getOmoOpenCodeCacheDir: () => join(TEST_DIR, "oh-my-opencode"),
  getOpenCodeCacheDir: () => TEST_CACHE_DIR,
}))
mock.module("../../../shared/opencode-config-dir", () => ({
  getOpenCodeConfigDir: () => TEST_CONFIG_DIR,
  getOpenCodeConfigPaths: () => ({
    configDir: TEST_CONFIG_DIR,
    configJson: join(TEST_CONFIG_DIR, "opencode.json"),
    configJsonc: join(TEST_CONFIG_DIR, "opencode.jsonc"),
    packageJson: join(TEST_CONFIG_DIR, "package.json"),
    omoConfig: join(TEST_CONFIG_DIR, "oh-my-opencode.json"),
  }),
}))

const modulePath = "./background-update-check?test"
const { runBackgroundUpdateCheck } = await import(modulePath)

describe("workspace resolution", () => {
  const mockCtx = { directory: "/test" } as PluginInput
  const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    // Setup test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })

    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstallWithDetails.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    // Note: Don't use mockResolvedValue here - it overrides the function that captures args
    mockSyncCachePackageJsonToIntent.mockReturnValue({ synced: true, error: null })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe("#given config-dir install exists but cache-dir does not", () => {
    it("installs to config-dir, not cache-dir", async () => {
      //#given - config-dir has installation, cache-dir does not
      mkdirSync(join(TEST_CONFIG_DIR, "node_modules", "oh-my-opencode"), { recursive: true })
      writeFileSync(
        join(TEST_CONFIG_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.4.0" } }, null, 2)
      )
      writeFileSync(
        join(TEST_CONFIG_DIR, "node_modules", "oh-my-opencode", "package.json"),
        JSON.stringify({ name: "oh-my-opencode", version: "3.4.0" }, null, 2)
      )

      // cache-dir should NOT exist
      expect(existsSync(TEST_CACHE_DIR)).toBe(false)

      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

      //#then - install should be called with config-dir
      const mockCalls = mockRunBunInstallWithDetails.mock.calls
      expect(mockCalls[0][0]?.workspaceDir).toBe(TEST_CONFIG_DIR)
    })
  })

  describe("#given both config-dir and cache-dir exist", () => {
    it("prefers config-dir over cache-dir", async () => {
      //#given - both directories have installations
      mkdirSync(join(TEST_CONFIG_DIR, "node_modules", "oh-my-opencode"), { recursive: true })
      writeFileSync(
        join(TEST_CONFIG_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.4.0" } }, null, 2)
      )
      writeFileSync(
        join(TEST_CONFIG_DIR, "node_modules", "oh-my-opencode", "package.json"),
        JSON.stringify({ name: "oh-my-opencode", version: "3.4.0" }, null, 2)
      )

      mkdirSync(join(TEST_CACHE_DIR, "node_modules", "oh-my-opencode"), { recursive: true })
      writeFileSync(
        join(TEST_CACHE_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.4.0" } }, null, 2)
      )
      writeFileSync(
        join(TEST_CACHE_DIR, "node_modules", "oh-my-opencode", "package.json"),
        JSON.stringify({ name: "oh-my-opencode", version: "3.4.0" }, null, 2)
      )

      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

      //#then - install should prefer config-dir
      const mockCalls2 = mockRunBunInstallWithDetails.mock.calls
      expect(mockCalls2[0][0]?.workspaceDir).toBe(TEST_CONFIG_DIR)
    })
  })

  describe("#given only cache-dir install exists", () => {
    it("falls back to cache-dir", async () => {
      //#given - only cache-dir has installation
      mkdirSync(join(TEST_CACHE_DIR, "node_modules", "oh-my-opencode"), { recursive: true })
      writeFileSync(
        join(TEST_CACHE_DIR, "package.json"),
        JSON.stringify({ dependencies: { "oh-my-opencode": "3.4.0" } }, null, 2)
      )
      writeFileSync(
        join(TEST_CACHE_DIR, "node_modules", "oh-my-opencode", "package.json"),
        JSON.stringify({ name: "oh-my-opencode", version: "3.4.0" }, null, 2)
      )

      // config-dir should NOT exist
      expect(existsSync(TEST_CONFIG_DIR)).toBe(false)

      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

      //#then - install should fall back to cache-dir
      const mockCalls3 = mockRunBunInstallWithDetails.mock.calls
      expect(mockCalls3[0][0]?.workspaceDir).toBe(TEST_CACHE_DIR)
    })
  })
})
