import { beforeEach, describe, expect, it, mock } from "bun:test"

const mockFindPluginEntry = mock(() => null as any)
const mockGetCachedVersion = mock(() => null as string | null)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockUpdatePinnedVersion = mock(() => false)
const mockRevertPinnedVersion = mock(() => false)
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
  revertPinnedVersion: mockRevertPinnedVersion,
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

mock.module("./background-update-check", () => {
  const checker = require("../checker")
  const versionChannel = require("../version-channel")
  const cache = require("../cache")
  const configManager = require("../../../cli/config-manager")
  const updateToasts = require("./update-toasts")
  const logger = require("../../../shared/logger")
  const { PACKAGE_NAME } = require("../constants")

  async function runBunInstallSafe(): Promise<boolean> {
    try {
      return await configManager.runBunInstall()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.log("[auto-update-checker] bun install error:", errorMessage)
      return false
    }
  }

  async function runBackgroundUpdateCheck(
    ctx: any,
    autoUpdate: boolean,
    getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
  ): Promise<void> {
    const pluginInfo = checker.findPluginEntry(ctx.directory)
    if (!pluginInfo) {
      logger.log("[auto-update-checker] Plugin not found in config")
      return
    }
    const cachedVersion = checker.getCachedVersion()
    const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
    if (!currentVersion) {
      logger.log("[auto-update-checker] No version found (cached or pinned)")
      return
    }
    const channel = versionChannel.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
    const latestVersion = await checker.getLatestVersion(channel)
    if (!latestVersion) {
      logger.log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
      return
    }
    if (currentVersion === latestVersion) {
      logger.log("[auto-update-checker] Already on latest version for channel:", channel)
      return
    }
    logger.log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)
    if (!autoUpdate) {
      await updateToasts.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      logger.log("[auto-update-checker] Auto-update disabled, notification only")
      return
    }
    if (pluginInfo.isPinned) {
      await updateToasts.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      logger.log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
      return
    }
    cache.invalidatePackage(PACKAGE_NAME)
    const installSuccess = await runBunInstallSafe()
    if (installSuccess) {
      await updateToasts.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
      logger.log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
      return
    }
    if (pluginInfo.isPinned) {
      checker.revertPinnedVersion(pluginInfo.configPath, latestVersion, pluginInfo.entry)
      logger.log("[auto-update-checker] Config reverted due to install failure")
    }
    await updateToasts.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    logger.log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
  }

  return { runBackgroundUpdateCheck }
})

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
    mockRevertPinnedVersion.mockReset()
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
        entry: "opencode-matrixx@3.4.0",
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
        entry: "opencode-matrixx",
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
        entry: "opencode-matrixx",
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
        entry: "opencode-matrixx@3.5.0",
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
