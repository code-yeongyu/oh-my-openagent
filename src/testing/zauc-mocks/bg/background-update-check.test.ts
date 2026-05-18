import type { PluginInput } from "@opencode-ai/plugin"
import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { PluginEntryInfo } from "../auto-update-checker/checker"
import type { SyncResult } from "../auto-update-checker/checker/sync-package-json"

type ToastMessageGetter = (isUpdate: boolean, version?: string) => string
let importCounter = 0

function createPluginEntry(overrides?: Partial<PluginEntryInfo>): PluginEntryInfo {
  return {
    entry: "oh-my-opencode@3.4.0",
    isPinned: false,
    pinnedVersion: null,
    configPath: "/test/opencode.json",
    ...overrides,
  }
}

const mockFindPluginEntry = mock((_directory: string): PluginEntryInfo | null => createPluginEntry())
const mockGetCachedVersion = mock((): string | null => "3.4.0")
const mockGetLatestVersion = mock(async (): Promise<string | null> => "3.5.0")
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockRunBunInstallWithDetails = mock(async () => ({ success: true }))
const mockShowUpdateAvailableToast = mock(
  async (_ctx: PluginInput, _latestVersion: string, _getToastMessage: ToastMessageGetter): Promise<void> => {},
)
const mockShowAutoUpdatedToast = mock(
  async (_ctx: PluginInput, _fromVersion: string, _toVersion: string): Promise<void> => {},
)
const mockLog = mock(() => {})
const mockSyncCachePackageJsonToIntent = mock((_pluginInfo: PluginEntryInfo): SyncResult => ({
  synced: true,
  error: null,
}))

async function createRunner() {
  const { createBackgroundUpdateCheckRunner } = await import(`../auto-update-checker/hook/background-update-check?test=${importCounter++}`)

  return createBackgroundUpdateCheckRunner({
    existsSync: () => false,
    join: (...parts) => parts.join("/"),
    runBunInstallWithDetails: mockRunBunInstallWithDetails as never,
    log: mockLog as never,
    getOpenCodeCacheDir: () => "/cache",
    getOpenCodeConfigPaths: () => ({
      configDir: "/config",
      configJson: "/config/opencode.json",
      configJsonc: "/config/opencode.jsonc",
      packageJson: "/config/package.json",
      omoConfig: "/config/oh-my-opencode.json",
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

describe("runBackgroundUpdateCheck", () => {
  const mockCtx = { directory: "/test" } as PluginInput
  const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    importCounter += 1
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstallWithDetails.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()
    mockLog.mockReset()
    mockSyncCachePackageJsonToIntent.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
    mockSyncCachePackageJsonToIntent.mockImplementation((_pluginInfo) => ({ synced: true, error: null }))
  })

  it("#given no plugin entry #when checking in background #then it returns early", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockFindPluginEntry.mockReturnValue(null)

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
    expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
  })

  it("#given no current version #when checking in background #then it returns early", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockFindPluginEntry.mockReturnValue(createPluginEntry({ entry: "oh-my-opencode" }))
    mockGetCachedVersion.mockReturnValue(null)

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockGetLatestVersion).not.toHaveBeenCalled()
    expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
  })

  it("#given latest version fetch fails #when checking in background #then it returns early", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockGetLatestVersion.mockResolvedValue(null)

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
    expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
  })

  it("#given current version is latest #when checking in background #then it does nothing", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockGetLatestVersion.mockResolvedValue("3.4.0")

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
    expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
  })

  it("#given auto update is disabled #when checking in background #then it shows notification only", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, false, getToastMessage)

    // #then
    expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
  })

  it("#given user pinned a version #when checking in background #then it skips auto update", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockFindPluginEntry.mockReturnValue(createPluginEntry({ isPinned: true, pinnedVersion: "3.4.0" }))

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
    expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
  })

  it("#given unpinned update succeeds #when checking in background #then it syncs invalidates installs and toasts", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
    expect(mockInvalidatePackage).toHaveBeenCalledTimes(1)
    expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(2)
    expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockCtx, "3.4.0", "3.5.0")
    expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
  })

  it("#given update succeeds #when checking in background #then it syncs before invalidate and install", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    const callOrder: string[] = []
    mockSyncCachePackageJsonToIntent.mockImplementation((_pluginInfo) => {
      callOrder.push("sync")
      return { synced: true, error: null }
    })
    mockInvalidatePackage.mockImplementation(() => {
      callOrder.push("invalidate")
    })
    mockRunBunInstallWithDetails.mockImplementation(async () => {
      callOrder.push("install")
      return { success: true }
    })

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(callOrder).toEqual(["sync", "invalidate", "install", "install"])
  })

  it("#given install fails #when checking in background #then it falls back to notification only", async () => {
    // #given
    const runBackgroundUpdateCheck = await createRunner()
    mockRunBunInstallWithDetails.mockResolvedValue({ success: false })

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
    expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
  })

  for (const syncError of ["parse_error", "write_error"] as const) {
    it(`#given sync fails with ${syncError} #when checking in background #then it aborts and shows notification only`, async () => {
      // #given
      const runBackgroundUpdateCheck = await createRunner()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: syncError,
        message: `sync failed: ${syncError}`,
      })

      // #when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

      // #then
      expect(mockInvalidatePackage).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  }
})
