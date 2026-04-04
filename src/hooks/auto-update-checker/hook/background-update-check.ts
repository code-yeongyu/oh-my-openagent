import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { runBunInstallWithDetails } from "../../../cli/config-manager"
import { log } from "../../../shared/logger"
import { getOpenCodeCacheDir, getOpenCodeConfigPaths } from "../../../shared"
import { invalidatePackage } from "../cache"
import { PACKAGE_NAME } from "../constants"
import { extractChannel } from "../version-channel"
import { findPluginEntry, getCachedVersion, getLatestVersion, syncCachePackageJsonToIntent } from "../checker"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

type BackgroundUpdateCheckDeps = {
  existsSync: typeof existsSync
  join: typeof join
  runBunInstallWithDetails: typeof runBunInstallWithDetails
  log: typeof log
  getOpenCodeCacheDir: typeof getOpenCodeCacheDir
  getOpenCodeConfigPaths: typeof getOpenCodeConfigPaths
  invalidatePackage: typeof invalidatePackage
  extractChannel: typeof extractChannel
  findPluginEntry: typeof findPluginEntry
  getCachedVersion: typeof getCachedVersion
  getLatestVersion: typeof getLatestVersion
  syncCachePackageJsonToIntent: typeof syncCachePackageJsonToIntent
  showUpdateAvailableToast: typeof showUpdateAvailableToast
  showAutoUpdatedToast: typeof showAutoUpdatedToast
}

type BackgroundUpdateCheckRunner = (
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
) => Promise<void>

const defaultDeps: BackgroundUpdateCheckDeps = {
  existsSync,
  join,
  runBunInstallWithDetails,
  log,
  getOpenCodeCacheDir,
  getOpenCodeConfigPaths,
  invalidatePackage,
  extractChannel,
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  syncCachePackageJsonToIntent,
  showUpdateAvailableToast,
  showAutoUpdatedToast,
}

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

/**
 * Resolves the active install workspace.
 * Same logic as doctor check: prefer config-dir if installed, fall back to cache-dir.
 */
function resolveActiveInstallWorkspace(deps: BackgroundUpdateCheckDeps): string {
  const configPaths = deps.getOpenCodeConfigPaths({ binary: "opencode" })
  const cacheDir = deps.getOpenCodeCacheDir()

  const configInstallPath = deps.join(configPaths.configDir, "node_modules", PACKAGE_NAME, "package.json")
  const cacheInstallPath = deps.join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")

  // Prefer config-dir if installed there, otherwise fall back to cache-dir
  if (deps.existsSync(configInstallPath)) {
    deps.log(`[auto-update-checker] Active workspace: config-dir (${configPaths.configDir})`)
    return configPaths.configDir
  }

  if (deps.existsSync(cacheInstallPath)) {
    deps.log(`[auto-update-checker] Active workspace: cache-dir (${cacheDir})`)
    return cacheDir
  }

  // Default to config-dir if neither exists (matches doctor behavior)
  deps.log(`[auto-update-checker] Active workspace: config-dir (default, no install detected)`)
  return configPaths.configDir
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

    const syncResult = deps.syncCachePackageJsonToIntent(pluginInfo)
    if (syncResult.error) {
      deps.log(`[auto-update-checker] Sync failed with error: ${syncResult.error}`, syncResult.message)
      await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
      return
    }

    deps.invalidatePackage(PACKAGE_NAME)
    const activeWorkspace = resolveActiveInstallWorkspace(deps)
    const installSuccess = await runBunInstallSafe(activeWorkspace, deps)

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
