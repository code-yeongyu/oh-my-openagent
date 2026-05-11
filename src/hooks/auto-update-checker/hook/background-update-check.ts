import type { PluginInput } from "@opencode-ai/plugin"
import { join } from "node:path"
import { runBunInstallWithDetails } from "../../../cli/config-manager"
import { log } from "../../../shared/logger"
import { getOpenCodeCacheDir } from "../../../shared"
import { invalidatePackage } from "../cache"
import { resolveManagedPluginSandboxWorkspace } from "../plugin-sandbox"
import { extractChannel } from "../version-channel"
import { findPluginEntry, getCachedVersion, getLatestVersion, syncCachePackageJsonToIntent } from "../checker"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

type BackgroundUpdateCheckDeps = {
  join: typeof join
  runBunInstallWithDetails: typeof runBunInstallWithDetails
  log: typeof log
  getOpenCodeCacheDir: typeof getOpenCodeCacheDir
  invalidatePackage: typeof invalidatePackage
  extractChannel: typeof extractChannel
  findPluginEntry: typeof findPluginEntry
  getCachedVersion: typeof getCachedVersion
  getLatestVersion: typeof getLatestVersion
  syncCachePackageJsonToIntent: typeof syncCachePackageJsonToIntent
  resolveManagedPluginSandboxWorkspace: typeof resolveManagedPluginSandboxWorkspace
  showUpdateAvailableToast: typeof showUpdateAvailableToast
  showAutoUpdatedToast: typeof showAutoUpdatedToast
}

type BackgroundUpdateCheckRunner = (
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
) => Promise<void>

function getCacheWorkspaceDir(deps: BackgroundUpdateCheckDeps): string {
  return deps.join(deps.getOpenCodeCacheDir(), "packages")
}

const defaultDeps: BackgroundUpdateCheckDeps = {
  join,
  runBunInstallWithDetails,
  log,
  getOpenCodeCacheDir,
  invalidatePackage,
  extractChannel,
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  syncCachePackageJsonToIntent,
  resolveManagedPluginSandboxWorkspace,
  showUpdateAvailableToast,
  showAutoUpdatedToast,
}

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

function resolveActiveInstallWorkspace(
  pluginEntry: string,
  deps: BackgroundUpdateCheckDeps,
): { packageName: string; workspaceDir: string } | null {
  const cacheDir = getCacheWorkspaceDir(deps)
  const sandboxWorkspace = deps.resolveManagedPluginSandboxWorkspace(pluginEntry, cacheDir)
  if (sandboxWorkspace) {
    deps.log(`[auto-update-checker] Active workspace: plugin sandbox (${sandboxWorkspace.workspaceDir})`)
    return {
      packageName: sandboxWorkspace.packageName,
      workspaceDir: sandboxWorkspace.workspaceDir,
    }
  }

  deps.log(`[auto-update-checker] Unsafe or unsupported plugin entry for auto-update: ${pluginEntry}`)
  return null
}

async function runBunInstallSafe(workspaceDir: string, deps: BackgroundUpdateCheckDeps): Promise<boolean> {
  try {
    const result = await deps.runBunInstallWithDetails({ outputMode: "pipe", workspaceDir })
    if (!result.success && result.error) {
      deps.log("[auto-update-checker] bun install error:", result.error)
    }
    return result.success
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    deps.log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

export function createBackgroundUpdateCheckRunner(
  overrides: Partial<BackgroundUpdateCheckDeps> = {},
): BackgroundUpdateCheckRunner {
  const deps = { ...defaultDeps, ...overrides }

  return async function runBackgroundUpdateCheck(
    ctx: PluginInput,
    autoUpdate: boolean,
    getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
  ): Promise<void> {
    const pluginInfo = deps.findPluginEntry(ctx.directory)
    if (!pluginInfo) {
      deps.log("[auto-update-checker] Plugin not found in config")
      return
    }

    const cachedVersion = deps.getCachedVersion()
    const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
    if (!currentVersion) {
      deps.log("[auto-update-checker] No version found (cached or pinned)")
      return
    }

    const channel = deps.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
    const latestVersion = await deps.getLatestVersion(channel)
    if (!latestVersion) {
      deps.log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
      return
    }

    if (currentVersion === latestVersion) {
      deps.log("[auto-update-checker] Already on latest version for channel:", channel)
      return
    }

    deps.log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

    if (!autoUpdate) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      deps.log("[auto-update-checker] Auto-update disabled, notification only")
      return
    }

    if (pluginInfo.isPinned) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, () => getPinnedVersionToastMessage(latestVersion))
      deps.log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
      return
    }

    const activeWorkspace = resolveActiveInstallWorkspace(pluginInfo.entry, deps)
    if (!activeWorkspace) {
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      return
    }

    const syncResult = deps.syncCachePackageJsonToIntent(
      pluginInfo,
      activeWorkspace.workspaceDir,
      activeWorkspace.packageName,
    )
    if (syncResult.error) {
      deps.log(`[auto-update-checker] Sync failed with error: ${syncResult.error}`, syncResult.message)
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      return
    }

    deps.invalidatePackage(activeWorkspace.packageName, activeWorkspace.workspaceDir)
    const installSuccess = await runBunInstallSafe(activeWorkspace.workspaceDir, deps)

    if (installSuccess) {
      await deps.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
      deps.log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
      return
    }

    await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    deps.log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
  }
}

export const runBackgroundUpdateCheck = createBackgroundUpdateCheckRunner()
