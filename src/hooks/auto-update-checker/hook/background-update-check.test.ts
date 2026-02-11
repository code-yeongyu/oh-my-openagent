import { describe, it, expect, mock, beforeEach } from "bun:test"

// Mock modules before importing
const mockFindPluginEntry = mock(() => null as any)
const mockGetCachedVersion = mock(() => null as string | null)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockUpdatePinnedVersion = mock(() => false)
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockRunBunInstall = mock(async () => true)
const mockShowUpdateAvailableToast = mock(async () => {})
const mockShowAutoUpdatedToast = mock(async () => {})

mock.module("../checker", () => ({
  findPluginEntry: mockFindPluginEntry,
  getCachedVersion: mockGetCachedVersion,
  getLatestVersion: mockGetLatestVersion,
  updatePinnedVersion: mockUpdatePinnedVersion,
}))

mock.module("../version-channel", () => ({
  extractChannel: mockExtractChannel,
}))

mock.module("../cache", () => ({
  invalidatePackage: mockInvalidatePackage,
}))

mock.module("../../../cli/config-manager", () => ({
  runBunInstall: mockRunBunInstall,
}))

mock.module("./update-toasts", () => ({
  showUpdateAvailableToast: mockShowUpdateAvailableToast,
  showAutoUpdatedToast: mockShowAutoUpdatedToast,
}))

mock.module("../../../shared/logger", () => ({
  log: () => {},
}))

const { runBackgroundUpdateCheck } = await import("./background-update-check")

describe("runBackgroundUpdateCheck", () => {
  const mockCtx = { directory: "/test" } as any
  const mockGetToastMessage = (isUpdate: boolean, version?: string) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockUpdatePinnedVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstall.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()

    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstall.mockResolvedValue(true)
  })

  describe("#given user has pinned a specific version", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue({
        entry: "oh-my-opencode@3.4.0",
        isPinned: true,
        pinnedVersion: "3.4.0",
        configPath: "/test/opencode.json",
      })
      mockGetCachedVersion.mockReturnValue("3.4.0")
      mockGetLatestVersion.mockResolvedValue("3.5.0")
    })

    it("#then should NOT call updatePinnedVersion", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockUpdatePinnedVersion).not.toHaveBeenCalled()
    })

    it("#then should show update-available toast instead", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(
        mockCtx,
        "3.5.0",
        mockGetToastMessage
      )
    })

    it("#then should NOT run bun install", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockRunBunInstall).not.toHaveBeenCalled()
    })

    it("#then should NOT invalidate package cache", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockInvalidatePackage).not.toHaveBeenCalled()
    })
  })

  describe("#given user has NOT pinned a version (unpinned)", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue({
        entry: "oh-my-opencode",
        isPinned: false,
        pinnedVersion: null,
        configPath: "/test/opencode.json",
      })
      mockGetCachedVersion.mockReturnValue("3.4.0")
      mockGetLatestVersion.mockResolvedValue("3.5.0")
    })

    it("#then should proceed with auto-update", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockInvalidatePackage).toHaveBeenCalled()
      expect(mockRunBunInstall).toHaveBeenCalled()
    })

    it("#then should show auto-updated toast on success", async () => {
      mockRunBunInstall.mockResolvedValue(true)

      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockShowAutoUpdatedToast).toHaveBeenCalled()
    })
  })

  describe("#given autoUpdate is false", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue({
        entry: "oh-my-opencode",
        isPinned: false,
        pinnedVersion: null,
        configPath: "/test/opencode.json",
      })
      mockGetCachedVersion.mockReturnValue("3.4.0")
      mockGetLatestVersion.mockResolvedValue("3.5.0")
    })

    it("#then should only show notification toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, false, mockGetToastMessage)

      expect(mockShowUpdateAvailableToast).toHaveBeenCalled()
      expect(mockRunBunInstall).not.toHaveBeenCalled()
      expect(mockUpdatePinnedVersion).not.toHaveBeenCalled()
    })
  })

  describe("#given already on latest version", () => {
    beforeEach(() => {
      mockFindPluginEntry.mockReturnValue({
        entry: "oh-my-opencode@3.5.0",
        isPinned: true,
        pinnedVersion: "3.5.0",
        configPath: "/test/opencode.json",
      })
      mockGetCachedVersion.mockReturnValue("3.5.0")
      mockGetLatestVersion.mockResolvedValue("3.5.0")
    })

    it("#then should not update or show toast", async () => {
      await runBackgroundUpdateCheck(mockCtx, true, mockGetToastMessage)

      expect(mockUpdatePinnedVersion).not.toHaveBeenCalled()
      expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
      expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    })
  })
})
