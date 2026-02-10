import { log } from "../../../shared/logger"
import type { UpdateCheckResult } from "../types"
import { extractChannel } from "../version-channel"
import { isLocalDevMode } from "./local-dev-path"
import { findPluginEntry } from "./plugin-entry"
import { getCachedVersion } from "./cached-version"
import { getLatestVersion } from "./latest-version"

export async function checkForUpdate(directory: string): Promise<UpdateCheckResult> {
  if (isLocalDevMode(directory)) {
    log("[auto-update-checker] Local dev mode detected, skipping update check")
    return {
      needsUpdate: false,
      currentVersion: null,
      latestVersion: null,
      isLocalDev: true,
      isPinned: false,
    }
  }

  const pluginInfo = findPluginEntry(directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return {
      needsUpdate: false,
      currentVersion: null,
      latestVersion: null,
      isLocalDev: false,
      isPinned: false,
    }
  }

  const currentVersion = getCachedVersion() ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No cached version found")
    return {
      needsUpdate: false,
      currentVersion: null,
      latestVersion: null,
      isLocalDev: false,
      isPinned: false,
    }
  }

  const channel = extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
  const latestVersion = await getLatestVersion(channel)
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
    return {
      needsUpdate: false,
      currentVersion,
      latestVersion: null,
      isLocalDev: false,
      isPinned: pluginInfo.isPinned,
    }
  }

  const needsUpdate = currentVersion !== latestVersion
  log(
    `[auto-update-checker] Current: ${currentVersion}, Latest (${channel}): ${latestVersion}, NeedsUpdate: ${needsUpdate}`
  )
  return {
    needsUpdate,
    currentVersion,
    latestVersion,
    isLocalDev: false,
    isPinned: pluginInfo.isPinned,
  }
}
