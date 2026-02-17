import { describe, it, expect, mock, beforeEach } from "bun:test"

const mockFindPluginEntry = mock(() => null as unknown)
const mockGetCachedVersion = mock(() => null as string | null)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockExtractChannel = mock(() => "latest")
const mockInvalidatePackage = mock(() => {})
const mockRunBunInstall = mock(async () => true)
const mockShowUpdateAvailableToast = mock(async () => {})
const mockShowAutoUpdatedToast = mock(async () => {})

const deps = {
  findPluginEntry: mockFindPluginEntry,
  getCachedVersion: mockGetCachedVersion,
  getLatestVersion: mockGetLatestVersion,
  extractChannel: mockExtractChannel,
  invalidatePackage: mockInvalidatePackage,
  runBunInstall: mockRunBunInstall,
  showUpdateAvailableToast: mockShowUpdateAvailableToast,
  showAutoUpdatedToast: mockShowAutoUpdatedToast,
}

async function runWithFreshModule(
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
): Promise<void> {
  const modulePath = `./background-update-check?test=${Date.now()}-${Math.random()}`
  const imported = await import(modulePath)
  await imported.runBackgroundUpdateCheck(
    { directory: "/test" } as never,
    autoUpdate,
    getToastMessage,
    deps as never,
  )
}

describe("runBackgroundUpdateCheck", () => {
  const getToastMessage = (isUpdate: boolean, version?: string) =>
    isUpdate ? `Update to ${version}` : "Up to date"

  beforeEach(() => {
    mockFindPluginEntry.mockReset()
    mockGetCachedVersion.mockReset()
    mockGetLatestVersion.mockReset()
    mockExtractChannel.mockReset()
    mockInvalidatePackage.mockReset()
    mockRunBunInstall.mockReset()
    mockShowUpdateAvailableToast.mockReset()
    mockShowAutoUpdatedToast.mockReset()

    mockExtractChannel.mockReturnValue("latest")
    mockRunBunInstall.mockResolvedValue(true)
  })

  it("uses notification-only flow for pinned versions", async () => {
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode@3.4.0",
      isPinned: true,
      pinnedVersion: "3.4.0",
      configPath: "/test/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")

    await runWithFreshModule(true, getToastMessage)

    expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(
      { directory: "/test" },
      "3.5.0",
      getToastMessage,
    )
    expect(mockInvalidatePackage).not.toHaveBeenCalled()
    expect(mockRunBunInstall).not.toHaveBeenCalled()
  })

  it("runs auto-update for unpinned versions", async () => {
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode",
      isPinned: false,
      pinnedVersion: null,
      configPath: "/test/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")
    mockRunBunInstall.mockResolvedValue(true)

    await runWithFreshModule(true, getToastMessage)

    expect(mockInvalidatePackage).toHaveBeenCalled()
    expect(mockRunBunInstall).toHaveBeenCalled()
    expect(mockShowAutoUpdatedToast).toHaveBeenCalledWith(
      { directory: "/test" },
      "3.4.0",
      "3.5.0",
    )
  })

  it("shows update-available only when autoUpdate=false", async () => {
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode",
      isPinned: false,
      pinnedVersion: null,
      configPath: "/test/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.4.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")

    await runWithFreshModule(false, getToastMessage)

    expect(mockShowUpdateAvailableToast).toHaveBeenCalledWith(
      { directory: "/test" },
      "3.5.0",
      getToastMessage,
    )
    expect(mockInvalidatePackage).not.toHaveBeenCalled()
    expect(mockRunBunInstall).not.toHaveBeenCalled()
  })

  it("does nothing when already up to date", async () => {
    mockFindPluginEntry.mockReturnValue({
      entry: "oh-my-opencode@3.5.0",
      isPinned: true,
      pinnedVersion: "3.5.0",
      configPath: "/test/opencode.json",
    })
    mockGetCachedVersion.mockReturnValue("3.5.0")
    mockGetLatestVersion.mockResolvedValue("3.5.0")

    await runWithFreshModule(true, getToastMessage)

    expect(mockShowUpdateAvailableToast).not.toHaveBeenCalled()
    expect(mockShowAutoUpdatedToast).not.toHaveBeenCalled()
    expect(mockInvalidatePackage).not.toHaveBeenCalled()
  })
})
