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
const mockSyncCachePackageJsonToIntent = mock((
  _pluginInfo: PluginEntryInfo,
  _options?: { sandboxWorkspace?: string | null },
): SyncResult => ({
  synced: true,
  error: null,
}))
const mockGetLoadedSandboxWorkspace = mock((): string | null => null)

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
    getLoadedSandboxWorkspace: mockGetLoadedSandboxWorkspace,
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
    mockGetLoadedSandboxWorkspace.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
    mockSyncCachePackageJsonToIntent.mockImplementation((_pluginInfo, _options) => ({ synced: true, error: null }))
    mockGetLoadedSandboxWorkspace.mockReturnValue(null)
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

  it("#given update succeeds #when checking in background #then it invalidates before sync and install", async () => {
    // #given
    // Issue #4318 follow-up: `invalidatePackage` deletes accepted-specifier
    // sandbox directories under the cache. If `syncCachePackageJsonToIntent`
    // ran first, the sandbox `package.json` we just wrote would be wiped
    // before `bun install` ran. The contract is: invalidate, then sync, then
    // install.
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
    expect(callOrder).toEqual(["invalidate", "sync", "install", "install"])
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

  it("#given a sandbox workspace is loaded #when checking in background #then sync and install target the sandbox (issue #4318)", async () => {
    // #given
    const sandboxDir = "/cache/packages/oh-my-openagent@latest"
    mockGetLoadedSandboxWorkspace.mockReturnValue(sandboxDir)
    const installedWorkspaces: string[] = []
    mockRunBunInstallWithDetails.mockImplementation(async (options) => {
      installedWorkspaces.push(options?.workspaceDir ?? "<default>")
      return { success: true }
    })
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledWith(
      expect.anything(),
      { sandboxWorkspace: sandboxDir },
    )
    // The sandbox is installed first; the flat cache workspace is primed afterwards.
    expect(installedWorkspaces[0]).toBe(sandboxDir)
    expect(installedWorkspaces).toContain("/cache/packages")
    expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockCtx, "3.4.0", "3.5.0")
  })

  it("#given an oh-my-openagent sandbox is loaded #when checking in background #then invalidate runs before sync writes the sandbox package.json (issue #4349)", async () => {
    // #given
    // Concrete regression for PR #4349 review concern: `invalidatePackage`
    // recursively removes accepted-specifier dirs under `<cache>/packages/`,
    // including `oh-my-openagent@latest/`. If sync wrote the package.json
    // first, invalidate would delete it before install. The fix is to
    // invalidate first, then sync, then install — and that invariant holds
    // regardless of which accepted alias names the sandbox.
    const sandboxDir = "/cache/packages/oh-my-openagent@latest"
    mockGetLoadedSandboxWorkspace.mockReturnValue(sandboxDir)
    const callOrder: string[] = []
    const observedSandboxOnSync: (string | null | undefined)[] = []
    mockInvalidatePackage.mockImplementation(() => {
      callOrder.push("invalidate")
    })
    mockSyncCachePackageJsonToIntent.mockImplementation((_pluginInfo, options) => {
      callOrder.push("sync")
      observedSandboxOnSync.push(options?.sandboxWorkspace ?? null)
      return { synced: true, error: null }
    })
    mockRunBunInstallWithDetails.mockImplementation(async (options) => {
      callOrder.push(`install:${options?.workspaceDir ?? "<default>"}`)
      return { success: true }
    })
    const runBackgroundUpdateCheck = await createRunner()

    // #when
    await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

    // #then
    expect(callOrder[0]).toBe("invalidate")
    expect(callOrder[1]).toBe("sync")
    expect(callOrder[2]).toBe(`install:${sandboxDir}`)
    expect(observedSandboxOnSync).toEqual([sandboxDir])
    expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockCtx, "3.4.0", "3.5.0")
  })

  for (const syncError of ["parse_error", "write_error"] as const) {
    it(`#given sync fails with ${syncError} #when checking in background #then it aborts before install and shows notification only`, async () => {
      // #given
      // Invalidate runs first now (issue #4318 follow-up), so it may have been
      // called by the time sync fails. The contract that matters is: no install
      // runs when sync fails, and the user gets a notification-only toast.
      const runBackgroundUpdateCheck = await createRunner()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: syncError,
        message: `sync failed: ${syncError}`,
      })

      // #when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)

      // #then
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  }
})
