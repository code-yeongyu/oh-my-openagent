import { describe, expect, mock, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createBackgroundUpdateCheckRunner } from "./background-update-check"

function createCtx(): PluginInput {
  return { directory: "/project" } as unknown as PluginInput
}

function joinPosix(...segments: string[]): string {
  return segments.join("/").replace(/\/+/g, "/")
}

describe("createBackgroundUpdateCheckRunner — OpenCode-managed sandbox (#4318)", () => {
  test("#given import.meta.url resolves outside the flat cache workspace and config-dir #when auto-update fires with autoUpdate=true #then bun install is skipped and only the update-available toast is shown (not 'Updated!')", async () => {
    // given — paths model the reported scenario:
    //   cacheDir = <CACHE_ROOT>/packages
    //   configDir = <config>
    //   sandboxDir = <CACHE_ROOT>/packages/<sanitized-spec>  (where OpenCode's
    //                Npm.add() installs the plugin)
    const cacheDir = "/cache/packages"
    const configDir = "/config"
    const sandboxDir = "/cache/packages/oh-my-openagent@^4.2"

    const findPluginEntry = mock(() => ({
      entry: "oh-my-openagent@^4.2",
      pinnedVersion: "^4.2",
      isPinned: false,
      configPath: "/project/opencode.json",
    }))
    const getCachedVersion = mock(() => "4.1.2")
    const getLatestVersion = mock(async () => "4.3.1")
    const extractChannel = mock(() => "stable")
    const syncCachePackageJsonToIntent = mock(() => ({ synced: true, error: null as null | "parse_error" | "write_error" }))
    const invalidatePackage = mock(() => true)
    const runBunInstallWithDetails = mock(async () => ({ success: true }))
    const getOpenCodeCacheDir = mock(() => "/cache")
    const getOpenCodeConfigPaths = mock(() => ({ configDir }))
    const existsSync = mock(() => false)
    const showUpdateAvailableToast = mock(async () => {})
    const showAutoUpdatedToast = mock(async () => {})
    const logCalls: unknown[][] = []
    const log = mock((...args: unknown[]) => { logCalls.push(args) })

    // KEY: import.meta.url resolves to a workspace that is neither the flat
    // cacheDir nor configDir — i.e. an OpenCode-managed sandbox. The current
    // code path silently runs `bun install` against the flat cacheDir, so
    // OpenCode (which loads from sandboxDir) never sees the new version and
    // we end up shipping a misleading "Updated!" toast.
    const getModuleHostingWorkspace = mock(() => sandboxDir)

    const runner = createBackgroundUpdateCheckRunner({
      existsSync,
      // The deps shape uses node's `join`; positional posix is enough for the
      // mocks below and lets us avoid pulling in node:path in this test.
      join: joinPosix as unknown as typeof import("node:path").join,
      runBunInstallWithDetails: runBunInstallWithDetails as unknown as typeof import("../../../cli/config-manager").runBunInstallWithDetails,
      log: log as unknown as typeof import("../../../shared/logger").log,
      getOpenCodeCacheDir,
      getOpenCodeConfigPaths,
      invalidatePackage,
      extractChannel,
      findPluginEntry,
      getCachedVersion,
      getLatestVersion,
      syncCachePackageJsonToIntent: syncCachePackageJsonToIntent as unknown as typeof import("../checker").syncCachePackageJsonToIntent,
      showUpdateAvailableToast,
      showAutoUpdatedToast,
      getModuleHostingWorkspace,
    } as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    const autoUpdate = true
    await runner(createCtx(), autoUpdate, (_isUpdate, latest) => `OhMyOpenCode Updated! v${latest}`)

    // then — install must NOT have run (we cannot reliably update a sandbox
    // OpenCode owns), and the user must see the truthful "update available"
    // toast rather than the misleading "Updated!" toast.
    expect(runBunInstallWithDetails).not.toHaveBeenCalled()
    expect(showAutoUpdatedToast).not.toHaveBeenCalled()
    expect(showUpdateAvailableToast).toHaveBeenCalledTimes(1)
  })

  test("#given import.meta.url resolves inside the flat cache workspace #when auto-update fires with autoUpdate=true #then existing install flow runs unchanged", async () => {
    // given
    const cacheDir = "/cache/packages"
    const configDir = "/config"

    const findPluginEntry = mock(() => ({
      entry: "oh-my-openagent",
      pinnedVersion: null,
      isPinned: false,
      configPath: "/project/opencode.json",
    }))
    const getCachedVersion = mock(() => "4.1.2")
    const getLatestVersion = mock(async () => "4.3.1")
    const extractChannel = mock(() => "stable")
    const syncCachePackageJsonToIntent = mock(() => ({ synced: true, error: null as null | "parse_error" | "write_error" }))
    const invalidatePackage = mock(() => true)
    const runBunInstallWithDetails = mock(async () => ({ success: true }))
    const getOpenCodeCacheDir = mock(() => "/cache")
    const getOpenCodeConfigPaths = mock(() => ({ configDir }))
    const existsSync = mock(() => false)
    const showUpdateAvailableToast = mock(async () => {})
    const showAutoUpdatedToast = mock(async () => {})
    const log = mock(() => {})
    // Sandbox detection returns the flat cacheDir itself → not a sandbox.
    const getModuleHostingWorkspace = mock(() => cacheDir)

    const runner = createBackgroundUpdateCheckRunner({
      existsSync,
      join: joinPosix as unknown as typeof import("node:path").join,
      runBunInstallWithDetails: runBunInstallWithDetails as unknown as typeof import("../../../cli/config-manager").runBunInstallWithDetails,
      log: log as unknown as typeof import("../../../shared/logger").log,
      getOpenCodeCacheDir,
      getOpenCodeConfigPaths,
      invalidatePackage,
      extractChannel,
      findPluginEntry,
      getCachedVersion,
      getLatestVersion,
      syncCachePackageJsonToIntent: syncCachePackageJsonToIntent as unknown as typeof import("../checker").syncCachePackageJsonToIntent,
      showUpdateAvailableToast,
      showAutoUpdatedToast,
      getModuleHostingWorkspace,
    } as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `OhMyOpenCode Updated! v${latest}`)

    // then — non-sandbox path keeps the legacy install flow.
    expect(runBunInstallWithDetails).toHaveBeenCalled()
    expect(showAutoUpdatedToast).toHaveBeenCalledTimes(1)
    expect(showUpdateAvailableToast).not.toHaveBeenCalled()
  })

  test("#given bun install throws a non-Error #when auto-update fires #then it falls back to update-available notification", async () => {
    // given
    const cacheDir = "/cache/packages"
    const configDir = "/config"
    const nonError = Symbol("install failed")

    const findPluginEntry = mock(() => ({
      entry: "oh-my-openagent",
      pinnedVersion: null,
      isPinned: false,
      configPath: "/project/opencode.json",
    }))
    const getCachedVersion = mock(() => "4.1.2")
    const getLatestVersion = mock(async () => "4.3.1")
    const extractChannel = mock(() => "stable")
    const syncCachePackageJsonToIntent = mock(() => ({ synced: true, error: null as null | "parse_error" | "write_error" }))
    const invalidatePackage = mock(() => true)
    const runBunInstallWithDetails = mock(async () => {
      throw nonError
    })
    const getOpenCodeCacheDir = mock(() => "/cache")
    const getOpenCodeConfigPaths = mock(() => ({ configDir }))
    const existsSync = mock(() => false)
    const showUpdateAvailableToast = mock(async () => {})
    const showAutoUpdatedToast = mock(async () => {})
    const log = mock(() => {})
    const getModuleHostingWorkspace = mock(() => cacheDir)

    const runner = createBackgroundUpdateCheckRunner({
      existsSync,
      join: joinPosix as unknown as typeof import("node:path").join,
      runBunInstallWithDetails: runBunInstallWithDetails as unknown as typeof import("../../../cli/config-manager").runBunInstallWithDetails,
      log: log as unknown as typeof import("../../../shared/logger").log,
      getOpenCodeCacheDir,
      getOpenCodeConfigPaths,
      invalidatePackage,
      extractChannel,
      findPluginEntry,
      getCachedVersion,
      getLatestVersion,
      syncCachePackageJsonToIntent: syncCachePackageJsonToIntent as unknown as typeof import("../checker").syncCachePackageJsonToIntent,
      showUpdateAvailableToast,
      showAutoUpdatedToast,
      getModuleHostingWorkspace,
    } as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `OhMyOpenCode Updated! v${latest}`)

    // then
    expect(runBunInstallWithDetails).toHaveBeenCalled()
    expect(showUpdateAvailableToast).toHaveBeenCalledTimes(1)
    expect(showAutoUpdatedToast).not.toHaveBeenCalled()
  })
})
