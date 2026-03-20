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

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

/**
 * Resolves the active install workspace.
 * Same logic as doctor check: prefer config-dir if installed, fall back to cache-dir.
 */
function resolveActiveInstallWorkspace(): string {
  const configPaths = getOpenCodeConfigPaths({ binary: "opencode" })
  const cacheDir = getOpenCodeCacheDir()

  const configInstallPath = join(configPaths.configDir, "node_modules", PACKAGE_NAME, "package.json")
  const cacheInstallPath = join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")

  // Prefer config-dir if installed there, otherwise fall back to cache-dir
  if (existsSync(configInstallPath)) {
    log(`[auto-update-checker] Active workspace: config-dir (${configPaths.configDir})`)
    return configPaths.configDir
  }

  if (existsSync(cacheInstallPath)) {
    log(`[auto-update-checker] Active workspace: cache-dir (${cacheDir})`)
    return cacheDir
  }

  // Default to config-dir if neither exists (matches doctor behavior)
  log(`[auto-update-checker] Active workspace: config-dir (default, no install detected)`)
  return configPaths.configDir
}

async function runBunInstallSafe(workspaceDir: string): Promise<boolean> {
  try {
    const result = await runBunInstallWithDetails({ outputMode: "pipe", workspaceDir })
    if (!result.success && result.error) {
      log("[auto-update-checker] bun install error:", result.error)
    }
    return result.success
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

export async function runBackgroundUpdateCheck(
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const cachedVersion = getCachedVersion()
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No version found (cached or pinned)")
    return
  }

  const channel = extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
  const latestVersion = await getLatestVersion(channel)
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
    return
  }

  if (currentVersion === latestVersion) {
    log("[auto-update-checker] Already on latest version for channel:", channel)
    return
  }

  log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

  if (!autoUpdate) {
    await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log("[auto-update-checker] Auto-update disabled, notification only")
    return
  }

  if (pluginInfo.isPinned) {
    await showUpdateAvailableToast(ctx, latestVersion, () => getPinnedVersionToastMessage(latestVersion))
    log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
    return
  }

  // Sync cache package.json to match opencode.json intent before updating
  // This handles the case where user switched from pinned version to tag (e.g., 3.10.0 -> @latest)
  const syncResult = syncCachePackageJsonToIntent(pluginInfo)

  // Abort on ANY sync error to prevent corrupting a bad state further
  if (syncResult.error) {
    log(`[auto-update-checker] Sync failed with error: ${syncResult.error}`, syncResult.message)
    await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    return
  }

  invalidatePackage(PACKAGE_NAME)

  const activeWorkspace = resolveActiveInstallWorkspace()
  const installSuccess = await runBunInstallSafe(activeWorkspace)

  if (installSuccess) {
    await showAutoUpdatedToast(ctx, currentVersion, latestVersion)
    log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
    return
  }

  await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
  log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
}
