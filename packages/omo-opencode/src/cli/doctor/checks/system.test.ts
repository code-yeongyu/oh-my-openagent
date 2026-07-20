/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { rmSync } from "node:fs"
import type { PathLike } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PLUGIN_NAME } from "../../../shared"
import type { PluginInfo } from "./system-plugin"
import type { OpenCodeBinaryInfo } from "./system-binary"
import { checkSystem } from "./system"

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
const mockGetLoadedPluginVersion = mock(() => ({
  cacheDir: "/Users/test/Library/Caches/opencode with spaces",
  cachePackagePath: "/tmp/package.json",
  installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
  expectedVersion: "3.0.0",
  loadedVersion: "3.1.0",
}))
const mockGetLatestPluginVersion = mock(async (_currentVersion: string | null) => null as string | null)
const mockGetSuggestedInstallTag = mock(() => "latest")
const mockConfigExists = mock((_path: PathLike) => true)
const mockReadConfigFile = mock((_path: string) => "{}")
const mockParseConfigContent = mock((_content: string) => ({}))

const temporaryDirectories: string[] = []

function createSystemDeps() {
  return {
    findOpenCodeBinary: mockFindOpenCodeBinary,
    getOpenCodeVersion: mockGetOpenCodeVersion,
    compareVersions: mockCompareVersions,
    getPluginInfo: mockGetPluginInfo,
    getLoadedPluginVersion: mockGetLoadedPluginVersion,
    getLatestPluginVersion: mockGetLatestPluginVersion,
    getSuggestedInstallTag: mockGetSuggestedInstallTag,
    configExists: mockConfigExists,
    readConfigFile: mockReadConfigFile,
    parseConfigContent: mockParseConfigContent,
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
    mockConfigExists.mockReset()
    mockReadConfigFile.mockReset()
    mockParseConfigContent.mockReset()

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
    mockConfigExists.mockReturnValue(true)
    mockReadConfigFile.mockReturnValue("{}")
    mockParseConfigContent.mockReturnValue({})
  })

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  describe("#given malformed config JSONC", () => {
    it("marks the config invalid without throwing", async () => {
      //#given
      const configPath = join(tmpdir(), "omo-system-config-malformed.jsonc")
      const deps = {
        findOpenCodeBinary: async () => ({
          binary: "opencode",
          path: "/usr/local/bin/opencode",
        }),
        getOpenCodeVersion: async () => "1.0.200",
        compareVersions: () => true,
        getPluginInfo: () => ({
          registered: false,
          entry: null,
          isPinned: false,
          pinnedVersion: null,
          configPath,
          isLocalDev: false,
        }),
        getLoadedPluginVersion: () => ({
          cacheDir: "/Users/test/Library/Caches/opencode with spaces",
          cachePackagePath: "/tmp/package.json",
          installedPackagePath: "/tmp/node_modules/oh-my-opencode/package.json",
          expectedVersion: "3.0.0",
          loadedVersion: "3.1.0",
        }),
        getLatestPluginVersion: async () => null,
        getSuggestedInstallTag: () => "latest",
        configExists: () => true,
        readConfigFile: () => "{",
        parseConfigContent: () => {
          throw new Error("Invalid JSONC")
        },
      }

      //#when
      const { gatherSystemInfo: freshGatherSystemInfo } = await import(`./system?malformed=${Date.now()}`)
      const result = await freshGatherSystemInfo(deps)

      //#then
      expect(result.configValid).toBe(false)
    })
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

    it("includes Bun postinstall trust guidance in the update fix command", async () => {
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
        'Update: cd "/Users/test/Library/Caches/opencode with spaces" && bun add oh-my-opencode@canary\n' +
          'If Bun reports blocked postinstalls, inspect them: cd "/Users/test/Library/Caches/opencode with spaces" && bun pm untrusted\n' +
          'Then trust only OMO-related packages from that list: cd "/Users/test/Library/Caches/opencode with spaces" && bun pm trust oh-my-opencode @code-yeongyu/comment-checker'
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
})
