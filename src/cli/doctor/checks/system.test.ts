import { beforeEach, describe, expect, it, mock } from "bun:test"

const mockFindOpenCodeBinary = mock(async () => ({ path: "/usr/local/bin/opencode" }))
const mockGetOpenCodeVersion = mock(async () => "1.0.200")
const mockCompareVersions = mock(() => true)
const mockGetPluginInfo = mock(() => ({
  registered: true,
  entry: "oh-my-opencode",
  isPinned: false,
  pinnedVersion: null,
  configPath: null,
  isLocalDev: false,
}))
const mockGetLoadedPluginVersion = mock(() => ({
  cacheDir: "/Users/test/Library/Caches/opencode with spaces",
  cachePackagePath: "/tmp/package.json",
  installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
  expectedVersion: "3.0.0",
  loadedVersion: "3.1.0",
}))
const mockGetLatestPluginVersion = mock(async () => null)

mock.module("./system-binary", () => ({
  findOpenCodeBinary: mockFindOpenCodeBinary,
  getOpenCodeVersion: mockGetOpenCodeVersion,
  compareVersions: mockCompareVersions,
}))

mock.module("./system-plugin", () => ({
  getPluginInfo: mockGetPluginInfo,
}))

mock.module("./system-loaded-version", () => ({
  getLoadedPluginVersion: mockGetLoadedPluginVersion,
  getLatestPluginVersion: mockGetLatestPluginVersion,
}))

const { checkSystem } = await import("./system?test")

describe("system check", () => {
  beforeEach(() => {
    mockFindOpenCodeBinary.mockReset()
    mockGetOpenCodeVersion.mockReset()
    mockCompareVersions.mockReset()
    mockGetPluginInfo.mockReset()
    mockGetLoadedPluginVersion.mockReset()
    mockGetLatestPluginVersion.mockReset()

    mockFindOpenCodeBinary.mockResolvedValue({ path: "/usr/local/bin/opencode" })
    mockGetOpenCodeVersion.mockResolvedValue("1.0.200")
    mockCompareVersions.mockReturnValue(true)
    mockGetPluginInfo.mockReturnValue({
      registered: true,
      entry: "oh-my-opencode",
      isPinned: false,
      pinnedVersion: null,
      configPath: null,
      isLocalDev: false,
    })
    mockGetLoadedPluginVersion.mockReturnValue({
      cacheDir: "/Users/test/Library/Caches/opencode with spaces",
      cachePackagePath: "/tmp/package.json",
      installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
      expectedVersion: "3.0.0",
      loadedVersion: "3.1.0",
    })
    mockGetLatestPluginVersion.mockResolvedValue(null)
  })

  describe("#given cache directory contains spaces", () => {
    it("uses a quoted cache directory in mismatch fix command", async () => {
      //#when
      const result = await checkSystem()

      //#then
      const mismatchIssue = result.issues.find((issue) => issue.title === "Loaded plugin version mismatch")
      expect(mismatchIssue?.fix).toBe('Reinstall: cd "/Users/test/Library/Caches/opencode with spaces" && bun install')
    })

    it("uses the loaded version channel for update fix command", async () => {
      //#given
      mockGetLoadedPluginVersion.mockReturnValue({
        cacheDir: "/Users/test/Library/Caches/opencode with spaces",
        cachePackagePath: "/tmp/package.json",
        installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
        expectedVersion: "3.0.0-canary.1",
        loadedVersion: "3.0.0-canary.1",
      })
      mockGetLatestPluginVersion.mockResolvedValue("3.0.0-canary.2")
      mockCompareVersions.mockImplementation((leftVersion: string, rightVersion: string) => {
        return !(leftVersion === "3.0.0-canary.1" && rightVersion === "3.0.0-canary.2")
      })

      //#when
      const result = await checkSystem()

      //#then
      const outdatedIssue = result.issues.find((issue) => issue.title === "Loaded plugin is outdated")
      expect(outdatedIssue?.fix).toBe(
        'Update: cd "/Users/test/Library/Caches/opencode with spaces" && bun add oh-my-opencode@canary'
      )
    })
  })
})
