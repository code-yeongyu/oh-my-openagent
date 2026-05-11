import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import type { PluginEntryInfo } from "../auto-update-checker/checker"
import type { SyncResult } from "../auto-update-checker/checker/sync-package-json"
import type { ManagedPluginSandboxWorkspace } from "../auto-update-checker/plugin-sandbox"

type ToastMessageGetter = (isUpdate: boolean, version?: string) => string
let importCounter = 0

function createPluginEntry(overrides?: Partial<PluginEntryInfo>): PluginEntryInfo {
  return {
    entry: "oh-my-openagent",
    isPinned: false,
    pinnedVersion: null,
    configPath: "/test/opencode.json",
    ...overrides,
  }
}

const TEST_DIR = join(import.meta.dir, "__test-workspace-resolution__")
const TEST_CACHE_DIR = join(TEST_DIR, "cache")
const TEST_CACHE_WORKSPACE_DIR = join(TEST_CACHE_DIR, "packages")
const TEST_SANDBOX_DIR = join(TEST_CACHE_WORKSPACE_DIR, "oh-my-openagent@latest")

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
const mockResolveManagedPluginSandboxWorkspace = mock(
  (_entry: string, _cachePackagesDir: string): ManagedPluginSandboxWorkspace | null => ({
    packageName: "oh-my-openagent",
    spec: "oh-my-openagent@latest",
    workspaceDir: TEST_SANDBOX_DIR,
  }),
)

async function createRunner() {
  const { createBackgroundUpdateCheckRunner } = await import(`../auto-update-checker/hook/background-update-check?test=${importCounter++}`)

  return createBackgroundUpdateCheckRunner({
    join,
    runBunInstallWithDetails: mockRunBunInstallWithDetails as never,
    log: mockLog as never,
    getOpenCodeCacheDir: () => TEST_CACHE_DIR,
    invalidatePackage: mockInvalidatePackage as never,
    extractChannel: mockExtractChannel,
    findPluginEntry: mockFindPluginEntry,
    getCachedVersion: mockGetCachedVersion,
    getLatestVersion: mockGetLatestVersion,
    syncCachePackageJsonToIntent: mockSyncCachePackageJsonToIntent,
    resolveManagedPluginSandboxWorkspace: mockResolveManagedPluginSandboxWorkspace,
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
    mockResolveManagedPluginSandboxWorkspace.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
    mockSyncCachePackageJsonToIntent.mockReturnValue({ synced: true, error: null })
    mockResolveManagedPluginSandboxWorkspace.mockReturnValue({
      packageName: "oh-my-openagent",
      spec: "oh-my-openagent@latest",
      workspaceDir: TEST_SANDBOX_DIR,
    })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it("#given managed plugin entry #when updating #then it resolves sandbox below cache packages", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockResolveManagedPluginSandboxWorkspace).toHaveBeenCalledWith("oh-my-openagent", TEST_CACHE_WORKSPACE_DIR)
  })

  it("#given managed plugin entry #when updating #then it syncs package json in sandbox workspace", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledWith(createPluginEntry(), TEST_SANDBOX_DIR, "oh-my-openagent")
  })

  it("#given managed plugin entry #when updating #then it invalidates sandbox package only", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockInvalidatePackage).toHaveBeenCalledWith("oh-my-openagent", TEST_SANDBOX_DIR)
  })

  it("#given managed plugin entry #when updating #then it installs to sandbox workspace once", async () => {
    // #given
    const runner = await createRunner()

    // #when
    await runner(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(1)
    expect(mockRunBunInstallWithDetails).toHaveBeenCalledWith({ outputMode: "pipe", workspaceDir: TEST_SANDBOX_DIR })
  })

  it("#given unsafe plugin entry #when updating #then it skips workspace mutation", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockFindPluginEntry.mockReturnValue(createPluginEntry({ entry: "oh-my-openagent@../../evil" }))
    mockResolveManagedPluginSandboxWorkspace.mockReturnValue(null)

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockSyncCachePackageJsonToIntent).not.toHaveBeenCalled()
    expect(mockInvalidatePackage).not.toHaveBeenCalled()
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
    expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
  })
})
