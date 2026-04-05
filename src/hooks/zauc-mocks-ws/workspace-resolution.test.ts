import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { PluginEntryInfo } from "../auto-update-checker/checker"
import type { SyncResult } from "../auto-update-checker/checker/sync-package-json"
import { PACKAGE_NAME } from "../auto-update-checker/constants"

type ToastMessageGetter = (isUpdate: boolean, version?: string) => string
let importCounter = 0

function createPluginEntry(overrides?: Partial<PluginEntryInfo>): PluginEntryInfo {
  return {
    entry: `${PACKAGE_NAME}@3.4.0`,
    isPinned: false,
    pinnedVersion: null,
    configPath: "/test/opencode.json",
    ...overrides,
  }
}

const TEST_DIR = join(import.meta.dir, "__test-workspace-resolution__")
const TEST_CACHE_DIR = join(TEST_DIR, "cache")
const TEST_CACHE_WORKSPACE_DIR = join(TEST_CACHE_DIR, "packages")
const TEST_CONFIG_DIR = join(TEST_DIR, "config")

const mockFindPluginEntry = mock((_directory: string): PluginEntryInfo | null => createPluginEntry())
const mockGetCachedVersion = mock((): string | null => "3.4.0")
const mockGetLatestVersion = mock(async (): Promise<string | null> => "3.5.0")
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockShowUpdateAvailableToast = mock(
  async (_ctx: PluginInput, _latestVersion: string, _getToastMessage: ToastMessageGetter): Promise<void> => {},
)
const mockShowAutoUpdatedToast = mock(
  async (_ctx: PluginInput, _fromVersion: string, _toVersion: string): Promise<void> => {},
)
const mockSyncCachePackageJsonToIntent = mock((_pluginInfo: PluginEntryInfo): SyncResult => ({ synced: true, error: null }))
const mockRunBunInstallWithDetails = mock(async (_opts?: { outputMode?: string; workspaceDir?: string }) => ({ success: true }))
const mockLog = mock(() => {})

async function createRunner() {
  const { createBackgroundUpdateCheckRunner } = await import(`../auto-update-checker/hook/background-update-check?test=${importCounter++}`)

  return createBackgroundUpdateCheckRunner({
    existsSync,
    join,
    runBunInstallWithDetails: mockRunBunInstallWithDetails as never,
    log: mockLog as never,
    getOpenCodeCacheDir: () => TEST_CACHE_DIR,
    getOpenCodeConfigPaths: () => ({
      configDir: TEST_CONFIG_DIR,
      configJson: join(TEST_CONFIG_DIR, "opencode.json"),
      configJsonc: join(TEST_CONFIG_DIR, "opencode.jsonc"),
      packageJson: join(TEST_CONFIG_DIR, "package.json"),
      omoConfig: join(TEST_CONFIG_DIR, "oh-my-openagent.json"),
    }),
    invalidatePackage: mockInvalidatePackage as never,
    extractChannel: mockExtractChannel,
    findPluginEntry: mockFindPluginEntry,
    getCachedVersion: mockGetCachedVersion,
    getLatestVersion: mockGetLatestVersion,
    syncCachePackageJsonToIntent: mockSyncCachePackageJsonToIntent,
    showUpdateAvailableToast: mockShowUpdateAvailableToast as never,
    showAutoUpdatedToast: mockShowAutoUpdatedToast as never,
  })
}

describe("workspace resolution", () => {
  const mockCtx = { directory: "/test" } as PluginInput
  const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    importCounter += 1
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
    mockSyncCachePackageJsonToIntent.mockReset()
    mockLog.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
    mockSyncCachePackageJsonToIntent.mockReturnValue({ synced: true, error: null })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it("#given config-dir install exists but cache-dir does not #when updating #then it installs to config-dir", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mkdirSync(join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME), { recursive: true })
    writeFileSync(join(TEST_CONFIG_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))
    writeFileSync(
      join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "3.4.0" }, null, 2),
    )

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails.mock.calls[0]?.[0]?.workspaceDir).toBe(TEST_CONFIG_DIR)
  })

  it("#given both config-dir and cache-dir installs exist #when updating #then it prefers config-dir", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mkdirSync(join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME), { recursive: true })
    writeFileSync(join(TEST_CONFIG_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))
    writeFileSync(
      join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "3.4.0" }, null, 2),
    )
    mkdirSync(join(TEST_CACHE_DIR, "node_modules", PACKAGE_NAME), { recursive: true })
    writeFileSync(join(TEST_CACHE_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))
    writeFileSync(
      join(TEST_CACHE_DIR, "node_modules", PACKAGE_NAME, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "3.4.0" }, null, 2),
    )

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails.mock.calls[0]?.[0]?.workspaceDir).toBe(TEST_CONFIG_DIR)
  })

  it("#given only cache-dir install exists #when updating #then it falls back to cache-dir", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mkdirSync(join(TEST_CACHE_WORKSPACE_DIR, "node_modules", PACKAGE_NAME), { recursive: true })
    writeFileSync(join(TEST_CACHE_WORKSPACE_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))
    writeFileSync(
      join(TEST_CACHE_WORKSPACE_DIR, "node_modules", PACKAGE_NAME, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "3.4.0" }, null, 2),
    )

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails.mock.calls[0]?.[0]?.workspaceDir).toBe(TEST_CACHE_WORKSPACE_DIR)
  })

  it("#given cache workspace package.json exists without installed module #when updating #then it installs to cache-dir", async () => {
    // #given
    const runner = await createRunner()
    mkdirSync(TEST_CACHE_WORKSPACE_DIR, { recursive: true })
    writeFileSync(join(TEST_CACHE_WORKSPACE_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))

    // #when
    await runner(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails.mock.calls[0]?.[0]?.workspaceDir).toBe(TEST_CACHE_WORKSPACE_DIR)
  })

  it("#given config-dir install exists #when updating #then it also primes the cache workspace", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mkdirSync(join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME), { recursive: true })
    writeFileSync(join(TEST_CONFIG_DIR, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "3.4.0" } }, null, 2))
    writeFileSync(
      join(TEST_CONFIG_DIR, "node_modules", PACKAGE_NAME, "package.json"),
      JSON.stringify({ name: PACKAGE_NAME, version: "3.4.0" }, null, 2),
    )

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails.mock.calls[0]?.[0]?.workspaceDir).toBe(TEST_CONFIG_DIR)
    expect(mockRunBunInstallWithDetails.mock.calls[1]?.[0]?.workspaceDir).toBe(TEST_CACHE_WORKSPACE_DIR)
  })
})
