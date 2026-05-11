/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"
import { PLUGIN_NAME } from "../../../shared"
import type { PluginInfo } from "./system-plugin"
import type { OpenCodeBinaryInfo } from "./system-binary"
import { checkSystem, gatherSystemInfo } from "./system"
import packageJson from "../../../../package.json" with { type: "json" }

const mockFindOpenCodeBinary = mock<() => Promise<OpenCodeBinaryInfo | null>>(async () => ({
  binary: "opencode",
  path: "/usr/local/bin/opencode",
}))
const mockGetOpenCodeVersion = mock(async () => "1.0.200")
const mockCompareVersions = mock((_leftVersion?: string, _rightVersion?: string) => true)
const mockGetPluginInfo = mock((): PluginInfo => ({
  registered: true,
  entry: "oh-my-opencode",
  isPinned: false,
  pinnedVersion: null,
  configPath: null,
  isLocalDev: false,
}))
interface LoadedPluginVersionMock {
  cacheDir: string
  cachePackagePath: string
  installedPackagePath: string
  expectedVersion: string | null
  loadedVersion: string | null
}
const mockGetLoadedPluginVersion = mock<() => LoadedPluginVersionMock>(() => ({
  cacheDir: "/Users/test/Library/Caches/opencode with spaces",
  cachePackagePath: "/tmp/package.json",
  installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
  expectedVersion: "3.0.0",
  loadedVersion: "3.1.0",
}))
const mockGetLatestPluginVersion = mock(async (_currentVersion: string | null) => null as string | null)
const mockGetSuggestedInstallTag = mock(() => "latest")


function createSystemDeps() {
  return {
    findOpenCodeBinary: mockFindOpenCodeBinary,
    getOpenCodeVersion: mockGetOpenCodeVersion,
    compareVersions: mockCompareVersions,
    getPluginInfo: mockGetPluginInfo,
    getLoadedPluginVersion: mockGetLoadedPluginVersion,
    getLatestPluginVersion: mockGetLatestPluginVersion,
    getSuggestedInstallTag: mockGetSuggestedInstallTag,
  }
}

describe("system check", () => {
  beforeEach(() => {
    mockFindOpenCodeBinary.mockReset()
    mockGetOpenCodeVersion.mockReset()
    mockCompareVersions.mockReset()
    mockGetPluginInfo.mockReset()
    mockGetLoadedPluginVersion.mockReset()
    mockGetLatestPluginVersion.mockReset()
    mockGetSuggestedInstallTag.mockReset()

    mockFindOpenCodeBinary.mockResolvedValue({
      binary: "opencode",
      path: "/usr/local/bin/opencode",
    })
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
    mockGetSuggestedInstallTag.mockReturnValue("latest")
  })

  describe("#given cache directory contains spaces", () => {
    it("uses a quoted cache directory in mismatch fix command", async () => {
      //#given
      //#when
      const result = await checkSystem(createSystemDeps())

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
      mockGetSuggestedInstallTag.mockReturnValue("canary")
      mockCompareVersions
        .mockImplementationOnce(() => true)
        .mockImplementationOnce(() => false)

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      const outdatedIssue = result.issues.find((issue) => issue.title === "Loaded plugin is outdated")
      expect(outdatedIssue?.fix).toBe(
        'Update: cd "/Users/test/Library/Caches/opencode with spaces" && bun add oh-my-opencode@canary'
      )
    })
  })

  describe("#given OpenCode plugin entry uses legacy package name", () => {
    it("adds a warning for a bare legacy entry", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: "oh-my-opencode",
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: false,
      })

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      const legacyEntryIssue = result.issues.find((issue) => issue.title === "Using legacy package name")
      expect(legacyEntryIssue?.severity).toBe("warning")
      expect(legacyEntryIssue?.fix).toBe(
        'Update your opencode.json plugin entry: "oh-my-opencode" → "oh-my-openagent"'
      )
    })

    it("adds a warning for a version-pinned legacy entry", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: "oh-my-opencode@3.0.0",
        isPinned: true,
        pinnedVersion: "3.0.0",
        configPath: null,
        isLocalDev: false,
      })

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      const legacyEntryIssue = result.issues.find((issue) => issue.title === "Using legacy package name")
      expect(legacyEntryIssue?.severity).toBe("warning")
      expect(legacyEntryIssue?.fix).toBe(
        'Update your opencode.json plugin entry: "oh-my-opencode@3.0.0" → "oh-my-openagent@3.0.0"'
      )
    })

    it("does not warn for a canonical plugin entry", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: PLUGIN_NAME,
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: false,
      })

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      expect(result.issues.some((issue) => issue.title === "Using legacy package name")).toBe(false)
    })

    it("does not warn for a local-dev legacy entry", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: "oh-my-opencode",
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: true,
      })

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      expect(result.issues.some((issue) => issue.title === "Using legacy package name")).toBe(false)
    })
  })

  describe("#given no pinned/expected/loaded versions are available (bunx install)", () => {
    it("falls back to the bundled package.json version for pluginVersion", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: PLUGIN_NAME,
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: false,
      })
      mockGetLoadedPluginVersion.mockReturnValue({
        cacheDir: "/tmp/cache",
        cachePackagePath: "/tmp/cache/package.json",
        installedPackagePath: "/tmp/cache/node_modules/oh-my-opencode/package.json",
        expectedVersion: null,
        loadedVersion: null,
      })

      //#when
      const systemInfo = await gatherSystemInfo(createSystemDeps())

      //#then
      expect(systemInfo.pluginVersion).toBe(packageJson.version)
      // loadedVersion intentionally stays null when getLoadedPluginVersion()
      // could not find a package on disk. Falsifying it to the bundled
      // version would mask broken installs and corrupt the
      // "Loaded plugin is outdated" comparison downstream.
      expect(systemInfo.loadedVersion).toBeNull()
    })

    it("renders Plugin expected with the bundled version and Plugin loaded as unknown in the report details", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: PLUGIN_NAME,
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: false,
      })
      mockGetLoadedPluginVersion.mockReturnValue({
        cacheDir: "/tmp/cache",
        cachePackagePath: "/tmp/cache/package.json",
        installedPackagePath: "/tmp/cache/node_modules/oh-my-opencode/package.json",
        expectedVersion: null,
        loadedVersion: null,
      })

      //#when
      const result = await checkSystem(createSystemDeps())

      //#then
      expect(result.details).toContain(`Plugin expected: ${packageJson.version}`)
      // Plugin loaded keeps "unknown" so downstream "outdated" warnings
      // do not fire spuriously against the bundled version.
      expect(result.details).toContain(`Plugin loaded: unknown`)
    })
  })

  describe("#given expected/loaded versions are available", () => {
    it("prefers the loaded version over the bundled fallback for pluginVersion", async () => {
      //#given
      mockGetPluginInfo.mockReturnValue({
        registered: true,
        entry: PLUGIN_NAME,
        isPinned: false,
        pinnedVersion: null,
        configPath: null,
        isLocalDev: false,
      })
      mockGetLoadedPluginVersion.mockReturnValue({
        cacheDir: "/tmp/cache",
        cachePackagePath: "/tmp/cache/package.json",
        installedPackagePath: "/tmp/cache/node_modules/oh-my-opencode/package.json",
        expectedVersion: "3.0.0",
        loadedVersion: "3.1.0",
      })

      //#when
      const systemInfo = await gatherSystemInfo(createSystemDeps())

      //#then
      expect(systemInfo.pluginVersion).toBe("3.0.0")
      expect(systemInfo.loadedVersion).toBe("3.1.0")
    })
  })
})
