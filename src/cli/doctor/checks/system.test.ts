/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import { PLUGIN_NAME } from "../../../shared"
import type { PluginInfo } from "./system-plugin"

type SystemModule = typeof import("./system")

const mockFindOpenCodeBinary = mock(async () => ({ path: "/usr/local/bin/opencode" }))
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
const mockInspectPluginCache = mock(() => ({
  entry: "oh-my-openagent",
  status: "healthy" as const,
  location: {
    entry: "oh-my-openagent",
    source: "npm" as const,
    packageName: "oh-my-openagent",
    cacheDir: "/Users/test/.cache/opencode/packages/oh-my-openagent",
    cachePackagePath: "/tmp/package.json",
    cacheLockfilePath: "/tmp/package-lock.json",
    installedPackageJsonPath: "/tmp/node_modules/oh-my-openagent/package.json",
  },
  requiredPaths: [],
  missingPaths: [],
}))

const realSystemBinary = require("./system-binary")
const realSystemPlugin = require("./system-plugin")
const realSystemLoadedVersion = require("./system-loaded-version")
const realPluginCacheHealth = require("../../config-manager/plugin-cache-health")

afterAll(() => {
  mock.module("./system-binary", () => realSystemBinary)
  mock.module("./system-plugin", () => realSystemPlugin)
  mock.module("./system-loaded-version", () => realSystemLoadedVersion)
  mock.module("../../config-manager/plugin-cache-health", () => realPluginCacheHealth)
  mock.restore()
})

async function importFreshSystemModule(): Promise<SystemModule> {
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
    getSuggestedInstallTag: mockGetSuggestedInstallTag,
  }))

  mock.module("../../config-manager/plugin-cache-health", () => ({
    inspectPluginCache: mockInspectPluginCache,
  }))

  return import(`./system?test=${Date.now()}-${Math.random()}`)
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
    mockInspectPluginCache.mockReset()

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
    mockGetSuggestedInstallTag.mockReturnValue("latest")
    mockInspectPluginCache.mockReturnValue({
      entry: "oh-my-openagent",
      status: "healthy",
      location: {
        entry: "oh-my-openagent",
        source: "npm",
        packageName: "oh-my-openagent",
        cacheDir: "/Users/test/.cache/opencode/packages/oh-my-openagent",
        cachePackagePath: "/tmp/package.json",
        cacheLockfilePath: "/tmp/package-lock.json",
        installedPackageJsonPath: "/tmp/node_modules/oh-my-openagent/package.json",
      },
      requiredPaths: [],
      missingPaths: [],
    })
  })

  describe("#given cache directory contains spaces", () => {
    it("uses a quoted cache directory in mismatch fix command", async () => {
      //#given
      const { checkSystem } = await importFreshSystemModule()

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
      mockGetSuggestedInstallTag.mockReturnValue("canary")
      mockCompareVersions.mockImplementation((leftVersion?: string, rightVersion?: string) => {
        return !(leftVersion === "3.0.0-canary.1" && rightVersion === "3.0.0-canary.2")
      })
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

      //#then
      const outdatedIssue = result.issues.find((issue) => issue.title === "Loaded plugin is outdated")
      expect(outdatedIssue?.fix).toBe(
        `Update: cd "/Users/test/Library/Caches/opencode with spaces" && bun add ${PLUGIN_NAME}@canary`
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
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

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
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

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
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

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
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

      //#then
      expect(result.issues.some((issue) => issue.title === "Using legacy package name")).toBe(false)
    })
  })

  describe("#given OpenCode 1.3.14 expects a package cache workspace", () => {
    it("adds an error when the registered package cache is missing", async () => {
      //#given
      mockGetOpenCodeVersion.mockResolvedValue("1.3.14")
      mockInspectPluginCache.mockReturnValue({
        entry: "oh-my-openagent@latest",
        status: "missing",
        location: {
          entry: "oh-my-openagent@latest",
          source: "npm",
          packageName: "oh-my-openagent",
          cacheDir: "/Users/test/.cache/opencode/packages/oh-my-openagent@latest",
          cachePackagePath: "/tmp/package.json",
          cacheLockfilePath: "/tmp/package-lock.json",
          installedPackageJsonPath: "/tmp/node_modules/oh-my-openagent/package.json",
        },
        requiredPaths: [],
        missingPaths: ["/tmp/package-lock.json"],
      })
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

      //#then
      const cacheIssue = result.issues.find((issue) => issue.title === "Plugin package cache is missing or incomplete")
      expect(cacheIssue?.severity).toBe("error")
      expect(cacheIssue?.fix).toContain("OpenCode 1.3.14 requires a populated plugin cache workspace")
      expect(cacheIssue?.fix).toContain(`Run: bunx ${PLUGIN_NAME} install`)
      expect(cacheIssue?.fix).toContain('/Users/test/.cache/opencode/packages/oh-my-openagent@latest')
    })

    it("does not report a cache error when the package cache is healthy", async () => {
      //#given
      mockGetOpenCodeVersion.mockResolvedValue("1.3.14")
      mockInspectPluginCache.mockReturnValue({
        entry: "oh-my-openagent",
        status: "healthy",
        location: {
          entry: "oh-my-openagent",
          source: "npm",
          packageName: "oh-my-openagent",
          cacheDir: "/Users/test/.cache/opencode/packages/oh-my-openagent",
          cachePackagePath: "/tmp/package.json",
          cacheLockfilePath: "/tmp/package-lock.json",
          installedPackageJsonPath: "/tmp/node_modules/oh-my-openagent/package.json",
        },
        requiredPaths: [],
        missingPaths: [],
      })
      const { checkSystem } = await importFreshSystemModule()

      //#when
      const result = await checkSystem()

      //#then
      expect(result.issues.some((issue) => issue.title === "Plugin package cache is missing or incomplete")).toBe(false)
    })
  })
})
