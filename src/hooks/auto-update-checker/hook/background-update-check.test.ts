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
const operationOrder: string[] = []
const mockSyncCachePackageJsonToIntent = mock((_pluginEntry: PluginEntry) => {
  operationOrder.push("sync")
})
const mockInvalidatePackage = mock((_packageName: string) => {
  operationOrder.push("invalidate")
})
const mockRunBunInstallWithDetails = mock(async () => ({ success: true }))
const mockShowUpdateAvailableToast = mock(
  async (_ctx: PluginInput, _latestVersion: string, _getToastMessage: ToastMessageGetter): Promise<void> => {}
)
const mockShowAutoUpdatedToast = mock(
  async (_ctx: PluginInput, _fromVersion: string, _toVersion: string): Promise<void> => {}
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
mock.module("../../../cli/config-manager", () => ({ runBunInstallWithDetails: mockRunBunInstallWithDetails }))
mock.module("./update-toasts", () => ({
  showUpdateAvailableToast: mockShowUpdateAvailableToast,
  showAutoUpdatedToast: mockShowAutoUpdatedToast,
}))
mock.module("../../../shared/logger", () => ({ log: () => {} }))

const modulePath = "./background-update-check?test"
const { runBackgroundUpdateCheck } = await import(modulePath)

const mockContext = { directory: "/test" } as PluginInput
const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
  isUpdate ? `Update to ${version}` : "Up to date"

async function runCheck(autoUpdate = true): Promise<void> {
  await runBackgroundUpdateCheck(mockContext, autoUpdate, getToastMessage)
}

function expectNoUpdateEffects(): void {
  expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
  expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
  expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
  expect(mockSyncCachePackageJsonToIntent).not.toHaveBeenCalled()
  expect(mockInvalidatePackage).not.toHaveBeenCalled()
}

describe("runBackgroundUpdateCheck", () => {
  let pluginEntry: PluginEntry

  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockSyncCachePackageJsonToIntent.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstallWithDetails.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()

    operationOrder.length = 0

    pluginEntry = createPluginEntry()
    mockFindPluginEntry.mockReturnValue(pluginEntry)
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
  })

  describe("#given no-op scenarios", () => {
    it.each([
      {
        name: "plugin entry is missing",
        setup: () => {
          mockFindPluginEntry.mockReturnValue(null)
        },
      },
      {
        name: "no cached or pinned version exists",
        setup: () => {
          mockFindPluginEntry.mockReturnValue(createPluginEntry({ entry: "oh-my-opencode" }))
          mockGetCachedVersion.mockReturnValue(null)
        },
      },
      {
        name: "latest version lookup fails",
        setup: () => {
          mockGetLatestVersion.mockResolvedValue(null)
        },
      },
      {
        name: "current version is already latest",
        setup: () => {
          mockGetLatestVersion.mockResolvedValue("3.4.0")
        },
      },
    ])("returns without user-visible update effects when $name", async ({ setup }) => {
      //#given
      setup()

      //#when
      await runCheck()

      //#then
      expectNoUpdateEffects()
    })
  })

  describe("#given update available with autoUpdate disabled", () => {
    it("shows update notification but does not install", async () => {
      //#given
      const autoUpdate = false
      //#when
      await runCheck(autoUpdate)
      //#then
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockContext, "3.5.0", getToastMessage)
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
      expect(operationOrder).toEqual([])
    })
  })

  describe("#given user has pinned a specific version", () => {
    it("shows pinned-version toast without auto-updating", async () => {
      //#given
      mockFindPluginEntry.mockReturnValue(createPluginEntry({ isPinned: true, pinnedVersion: "3.4.0" }))
      //#when
      await runCheck()
      //#then
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })

    it("toast message mentions version pinned", async () => {
      //#given
      let capturedToastMessage: ToastMessageGetter | undefined
      mockFindPluginEntry.mockReturnValue(createPluginEntry({ isPinned: true, pinnedVersion: "3.4.0" }))
      mockShowUpdateAvailableToast.mockImplementation(
        async (_ctx: PluginInput, _latestVersion: string, toastMessage: ToastMessageGetter) => {
          capturedToastMessage = toastMessage
        }
      )
      //#when
      await runCheck()
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
    it("invalidates cache, installs, and shows auto-updated toast", async () => {
      //#given
      mockRunBunInstallWithDetails.mockResolvedValue({ success: true })
      //#when
      await runCheck()
      //#then
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledWith(pluginEntry)
      expect(mockInvalidatePackage).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledWith({ outputMode: "pipe" })
      expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(mockContext, "3.4.0", "3.5.0")
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(operationOrder).toEqual(["sync", "invalidate"])
    })
  })

  describe("#given unpinned with auto-update and install fails", () => {
    it("falls back to notification-only toast", async () => {
      //#given
      mockRunBunInstallWithDetails.mockResolvedValue({ success: false, error: "install failed" })
      //#when
      await runCheck()
      //#then
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstallWithDetails).toHaveBeenCalledWith({ outputMode: "pipe" })
      expect(mockSyncCachePackageJsonToIntent).toHaveBeenCalledWith(pluginEntry)
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(mockContext, "3.5.0", getToastMessage)
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
      expect(operationOrder).toEqual(["sync", "invalidate"])
    })
  })
})
