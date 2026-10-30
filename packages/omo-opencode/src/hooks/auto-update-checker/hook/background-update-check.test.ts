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
      scheduleSandboxRefresh: mock(() => {}),
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
      scheduleSandboxRefresh: mock(() => {}),
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
      scheduleSandboxRefresh: mock(() => {}),
    } as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `OhMyOpenCode Updated! v${latest}`)

    // then
    expect(runBunInstallWithDetails).toHaveBeenCalled()
    expect(showUpdateAvailableToast).toHaveBeenCalledTimes(1)
    expect(showAutoUpdatedToast).not.toHaveBeenCalled()
  })
})

describe("createBackgroundUpdateCheckRunner — sandbox refresh + strictly-newer gate", () => {
  function createSandboxDeps(overrides: {
    cachedVersion: string
    latestVersion: string
    isPinned?: boolean
    entry?: string
    pinnedVersion?: string | null
    unappliedRefresh?: string
  }) {
    const configDir = "/config"
    const sandboxDir = "/cache/packages/oh-my-openagent@beta"

    const findPluginEntry = mock(() => ({
      entry: overrides.entry ?? "oh-my-openagent@beta",
      pinnedVersion: overrides.pinnedVersion === undefined ? "beta" : overrides.pinnedVersion,
      isPinned: overrides.isPinned ?? false,
      configPath: "/project/opencode.json",
    }))
    const deps = {
      existsSync: mock(() => false),
      join: joinPosix as unknown as typeof import("node:path").join,
      runBunInstallWithDetails: mock(async () => ({ success: true })) as unknown as typeof import("../../../cli/config-manager").runBunInstallWithDetails,
      log: mock(() => {}) as unknown as typeof import("../../../shared/logger").log,
      getOpenCodeCacheDir: mock(() => "/cache"),
      getOpenCodeConfigPaths: mock(() => ({ configDir })),
      invalidatePackage: mock(() => true),
      extractChannel: mock(() => "beta"),
      findPluginEntry,
      getCachedVersion: mock(() => overrides.cachedVersion),
      getLatestVersion: mock(async () => overrides.latestVersion),
      syncCachePackageJsonToIntent: mock(() => ({ synced: true, error: null as null | "parse_error" | "write_error" })) as unknown as typeof import("../checker").syncCachePackageJsonToIntent,
      showUpdateAvailableToast: mock(async () => {}),
      showAutoUpdatedToast: mock(async () => {}),
      getModuleHostingWorkspace: mock(() => sandboxDir),
      scheduleSandboxRefresh: mock((): string | null => overrides.unappliedRefresh ?? null),
    }
    return { deps, sandboxDir }
  }

  test("#given an OpenCode-managed sandbox with a strictly newer channel version #when the background check runs #then the sandbox refresh is scheduled for process exit and the toast stays truthful", async () => {
    // given
    const { deps, sandboxDir } = createSandboxDeps({ cachedVersion: "5.0.0-beta.85", latestVersion: "5.0.0-beta.89" })
    const runner = createBackgroundUpdateCheckRunner(deps as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `v${latest} available. Restart to apply.`)

    // then — the next OpenCode start must actually load the newer version:
    // the sandbox the runtime loaded from is invalidated when this process exits.
    expect(deps.scheduleSandboxRefresh).toHaveBeenCalledTimes(1)
    expect(deps.scheduleSandboxRefresh).toHaveBeenCalledWith(sandboxDir)
    expect(deps.showUpdateAvailableToast).toHaveBeenCalledTimes(1)
    expect(deps.runBunInstallWithDetails).not.toHaveBeenCalled()
  })

  test("#given the loaded version is NEWER than the registry tag #when the background check runs #then no update is offered and nothing is scheduled (no downgrade)", async () => {
    // given
    const { deps } = createSandboxDeps({ cachedVersion: "5.0.0-beta.90", latestVersion: "5.0.0-beta.89" })
    const runner = createBackgroundUpdateCheckRunner(deps as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `v${latest} available. Restart to apply.`)

    // then
    expect(deps.showUpdateAvailableToast).not.toHaveBeenCalled()
    expect(deps.showAutoUpdatedToast).not.toHaveBeenCalled()
    expect(deps.scheduleSandboxRefresh).not.toHaveBeenCalled()
    expect(deps.runBunInstallWithDetails).not.toHaveBeenCalled()
  })

  test("#given a user-pinned exact version in a sandbox #when a newer version exists #then it notifies only and never schedules a refresh", async () => {
    // given
    const { deps } = createSandboxDeps({
      cachedVersion: "5.0.0-beta.85",
      latestVersion: "5.0.0-beta.89",
      isPinned: true,
      entry: "oh-my-openagent@5.0.0-beta.85",
      pinnedVersion: "5.0.0-beta.85",
    })
    const runner = createBackgroundUpdateCheckRunner(deps as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `v${latest} available. Restart to apply.`)

    // then
    expect(deps.showUpdateAvailableToast).toHaveBeenCalledTimes(1)
    expect(deps.scheduleSandboxRefresh).not.toHaveBeenCalled()
  })

  test("#given the same version as the registry tag #when the background check runs #then nothing happens", async () => {
    // given
    const { deps } = createSandboxDeps({ cachedVersion: "5.0.0-beta.89", latestVersion: "5.0.0-beta.89" })
    const runner = createBackgroundUpdateCheckRunner(deps as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, (_isUpdate, latest) => `v${latest} available. Restart to apply.`)

    // then
    expect(deps.showUpdateAvailableToast).not.toHaveBeenCalled()
    expect(deps.scheduleSandboxRefresh).not.toHaveBeenCalled()
  })

  test("#given the last restart could not apply the refresh #when the background check runs #then the toast says so instead of repeating restart to apply", async () => {
    // given
    const { deps, sandboxDir } = createSandboxDeps({
      cachedVersion: "5.0.0-beta.85",
      latestVersion: "5.0.0-beta.89",
      unappliedRefresh: "could not remove it: EBUSY",
    })
    const restartToApply = (_isUpdate: boolean, latest?: string) => `v${latest} available. Restart to apply.`
    const runner = createBackgroundUpdateCheckRunner(deps as Parameters<typeof createBackgroundUpdateCheckRunner>[0])

    // when
    await runner(createCtx(), /* autoUpdate */ true, restartToApply)

    // then - the message points at the directory to remove
    const [, , message] = deps.showUpdateAvailableToast.mock.calls[0] as unknown as [unknown, string, (isUpdate: boolean, latest?: string) => string]
    expect(message).not.toBe(restartToApply)
    expect(message(true, "5.0.0-beta.89")).toContain(sandboxDir)
  })
})
