import type { PluginInput } from "@opencode-ai/plugin"
import { runBunInstall } from "../../../cli/config-manager"
import { log } from "../../../shared/logger"
import { invalidatePackage } from "../cache"
import { PACKAGE_NAME } from "../constants"
import { extractChannel } from "../version-channel"
import { findPluginEntry, getCachedVersion, getLatestVersion } from "../checker"
import { showAutoUpdatedToast, showUpdateAvailableToast } from "./update-toasts"

type BackgroundUpdateCheckDeps = {
  findPluginEntry: typeof findPluginEntry
  getCachedVersion: typeof getCachedVersion
  getLatestVersion: typeof getLatestVersion
  extractChannel: typeof extractChannel
  invalidatePackage: typeof invalidatePackage
  runBunInstall: typeof runBunInstall
  showUpdateAvailableToast: typeof showUpdateAvailableToast
  showAutoUpdatedToast: typeof showAutoUpdatedToast
}

const defaultDeps: BackgroundUpdateCheckDeps = {
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  extractChannel,
  invalidatePackage,
  runBunInstall,
  showUpdateAvailableToast,
  showAutoUpdatedToast,
}

async function runBunInstallSafe(runInstall: () => Promise<boolean>): Promise<boolean> {
  try {
    return await runInstall()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

export async function runBackgroundUpdateCheck(
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string,
  overrides?: Partial<BackgroundUpdateCheckDeps>,
): Promise<void> {
  const deps: BackgroundUpdateCheckDeps = { ...defaultDeps, ...overrides }

  const pluginInfo = deps.findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const cachedVersion = deps.getCachedVersion()
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No version found (cached or pinned)")
    return
  }

  const channel = deps.extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
  const latestVersion = await deps.getLatestVersion(channel)
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
    await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log("[auto-update-checker] Auto-update disabled, notification only")
    return
  }

  if (pluginInfo.isPinned) {
    await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
    return
  }

  deps.invalidatePackage(PACKAGE_NAME)

  const installSuccess = await runBunInstallSafe(deps.runBunInstall)

  if (installSuccess) {
    await deps.showAutoUpdatedToast(ctx, currentVersion, latestVersion)
    log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
    return
  }

  await deps.showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
  log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
}
