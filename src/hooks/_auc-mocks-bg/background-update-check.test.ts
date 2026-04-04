import type { PluginInput } from "@opencode-ai/plugin"
import { beforeEach, describe, expect, it, mock } from "bun:test"

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

const mockFindPluginEntry = mock((_directory: string): PluginEntry | null => createPluginEntry())
const mockGetCachedVersion = mock((): string | null => "3.4.0")
const mockGetLatestVersion = mock(async (): Promise<string | null> => "3.5.0")
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockRunBunInstallWithDetails = mock(async () => ({ success: true }))
const mockShowUpdateAvailableToast = mock(
  async (_ctx: PluginInput, _latestVersion: string, _getToastMessage: ToastMessageGetter): Promise<void> => {}
)
const mockShowAutoUpdatedToast = mock(
  async (_ctx: PluginInput, _fromVersion: string, _toVersion: string): Promise<void> => {}
)

const mockSyncCachePackageJsonToIntent = mock(() => false)

let importCounter = 0

async function importFreshBackgroundUpdateCheck(): Promise<typeof import("../auto-update-checker/hook/background-update-check")> {
  mock.module("../auto-update-checker/checker", () => ({
    findPluginEntry: mockFindPluginEntry,
    getCachedVersion: mockGetCachedVersion,
    getLatestVersion: mockGetLatestVersion,
    revertPinnedVersion: mock(() => false),
    syncCachePackageJsonToIntent: mockSyncCachePackageJsonToIntent,
  }))
  mock.module("../auto-update-checker/version-channel", () => ({ extractChannel: mockExtractChannel }))
  mock.module("../auto-update-checker/cache", () => ({ invalidatePackage: mockInvalidatePackage }))
  mock.module("../../cli/config-manager", () => ({ runBunInstallWithDetails: mockRunBunInstallWithDetails }))
  mock.module("../auto-update-checker/hook/update-toasts", () => ({
    showUpdateAvailableToast: mockShowUpdateAvailableToast,
    showAutoUpdatedToast: mockShowAutoUpdatedToast,
  }))
  mock.module("../../shared/logger", () => ({ log: () => {} }))

  const backgroundUpdateCheckModule = await import(`../auto-update-checker/hook/background-update-check?test=${importCounter++}`)
  mock.restore()
  return backgroundUpdateCheckModule
}

describe("runBackgroundUpdateCheck", () => {
  const mockCtx = { directory: "/test" } as PluginInput
  const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstallWithDetails.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()
    mockSyncCachePackageJsonToIntent.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
    mockSyncCachePackageJsonToIntent.mockReturnValue({ synced: true, error: null })
  })

  describe("#given no plugin entry found", () => {
    it("returns early without showing any toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockFindPluginEntry.mockReturnValue(null)
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockFindPluginEntry).toHaveBeenCalledTimes(1)
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
    })
  })

  describe("#given no version available", () => {
    it("returns early when neither cached nor pinned version exists", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockFindPluginEntry.mockReturnValue(createPluginEntry({ entry: "oh-my-opencode" }))
      mockGetCachedVersion.mockReturnValue(null)
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockGetCachedVersion).toHaveBeenCalledTimes(1)
      expect(mockGetLatestVersion).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given latest version fetch fails", () => {
    it("returns early without toasts", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockGetLatestVersion.mockResolvedValue(null)
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockGetLatestVersion).toHaveBeenCalledWith("latest")
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given already on latest version", () => {
    it("returns early without any action", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockGetCachedVersion.mockReturnValue("3.4.0")
      mockGetLatestVersion.mockResolvedValue("3.4.0")
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockGetLatestVersion).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given update available with autoUpdate disabled", () => {
    it("shows update notification but does not install", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      const autoUpdate = false
      //#when
      await runBackgroundUpdateCheck(mockCtx, autoUpdate, getToastMessage)
      //#then
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given user has pinned a specific version", () => {
    it("shows pinned-version toast without auto-updating", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockFindPluginEntry.mockReturnValue(createPluginEntry({ isPinned: true, pinnedVersion: "3.4.0" }))
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })

    it("toast message mentions version pinned", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      let capturedToastMessage: ToastMessageGetter | undefined
      mockFindPluginEntry.mockReturnValue(createPluginEntry({ isPinned: true, pinnedVersion: "3.4.0" }))
      mockShowUpdateAvailableToast.mockImplementation(
        async (_ctx: PluginInput, _latestVersion: string, toastMessage: ToastMessageGetter) => {
          capturedToastMessage = toastMessage
        }
      )
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(capturedToastMessage).toBeDefined()
      if (!capturedToastMessage) {
        throw new Error("toast message callback missing")
      }
      const message = capturedToastMessage(true, "3.5.0")
      expect(message).toContain("version pinned")
      expect(message).not.toBe("Update to 3.5.0")
    })
  })

  describe("#given unpinned with auto-update and install succeeds", () => {
    it("syncs cache, invalidates, installs, and shows auto-updated toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
      expect(mockInvalidatePackage).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockCtx, "3.4.0", "3.5.0")
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
    })

    it("syncs before invalidate and install (correct order)", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      const callOrder: string[] = []
      mockSyncCachePackageJsonToIntent.mockImplementation(() => {
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
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(callOrder).toEqual(["sync", "invalidate", "install"])
    })
  })

  describe("#given unpinned with auto-update and install fails", () => {
    it("falls back to notification-only toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockRunBunInstallWithDetails.mockResolvedValue({ success: false })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(1)
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given sync fails with file_not_found", () => {
    it("aborts update and shows notification-only toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: "file_not_found",
        message: "Cache package.json not found",
      })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
      expect(mockInvalidatePackage).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given sync fails with plugin_not_in_deps", () => {
    it("aborts update and shows notification-only toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: "plugin_not_in_deps",
        message: "Plugin not in cache package.json dependencies",
      })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
      expect(mockInvalidatePackage).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given sync fails with parse_error", () => {
    it("aborts update and shows notification-only toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: "parse_error",
        message: "Failed to parse cache package.json (malformed JSON)",
      })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
      expect(mockInvalidatePackage).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })

  describe("#given sync fails with write_error", () => {
    it("aborts update and shows notification-only toast", async () => {
      //#given
      const { runBackgroundUpdateCheck } = await importFreshBackgroundUpdateCheck()
      mockSyncCachePackageJsonToIntent.mockReturnValue({
        synced: false,
        error: "write_error",
        message: "Failed to write cache package.json",
      })
      //#when
      await runBackgroundUpdateCheck(mockCtx, true, getToastMessage)
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledTimes(1)
      expect(mockInvalidatePackage).not.toHaveBeenCalled()
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockCtx, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })
})
