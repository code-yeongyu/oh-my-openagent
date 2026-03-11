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
const mockRunBunInstall = mock(async () => true)
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
}))
mock.module("../version-channel", () => ({ extractChannel: mockExtractChannel }))
mock.module("../cache", () => ({ invalidatePackage: mockInvalidatePackage }))
mock.module("../../../cli/config-manager", () => ({ runBunInstall: mockRunBunInstall }))
mock.module("./update-toasts", () => ({
  showUpdateAvailableToast: mockShowUpdateAvailableToast,
  showAutoUpdatedToast: mockShowAutoUpdatedToast,
}))
mock.module("../../../shared/logger", () => ({ log: () => {} }))

const modulePath = "./background-update-check?test"
const { runBackgroundUpdateCheck } = await import(modulePath)

async function runCheck(autoUpdate = true): Promise<void> {
  const mockContext = { directory: "/test" } as PluginInput
  const getToastMessage: ToastMessageGetter = (isUpdate, version) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  await runBackgroundUpdateCheck(mockContext, autoUpdate, getToastMessage)
}

function expectNoUpdateEffects(): void {
  expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
  expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
  expect(mockRunBunInstall).not.toHaveBeenCalled()
}

describe("runBackgroundUpdateCheck", () => {
  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstall.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()

    mockFindPluginEntry.mockReturnValue(createPluginEntry())
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstall.mockResolvedValue(true)
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
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/test" }),
        "3.5.0",
        expect.any(Function)
      )
      expect(mockRunBunInstall).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
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
      expect(mockRunBunInstall).not.toHaveBeenCalled()
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
      mockRunBunInstall.mockResolvedValue(true)
      //#when
      await runCheck()
      //#then
      expect(mockInvalidatePackage).toHaveBeenCalledTimes(1)
      expect(mockRunBunInstall).toHaveBeenCalledTimes(1)
      expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/test" }),
        "3.4.0",
        "3.5.0"
      )
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
    })
  })

  describe("#given unpinned with auto-update and install fails", () => {
    it("falls back to notification-only toast", async () => {
      //#given
      mockRunBunInstall.mockResolvedValue(false)
      //#when
      await runCheck()
      //#then
      expect(mockRunBunInstall).toHaveBeenCalledTimes(1)
      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/test" }),
        "3.5.0",
        expect.any(Function)
      )
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })
})
