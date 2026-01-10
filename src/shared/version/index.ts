/**
 * Version management module
 *
 * Provides comprehensive version handling including:
 * - Semver parsing and comparison
 * - Release channel detection
 * - NPM registry integration
 * - Runtime version resolution
 */

export * from "./types"
export * from "./semver"
export * from "./channels"
export * from "./registry"
export * from "./resolver"

import type { VersionCheckResult, ReleaseChannel, DistTags } from "./types"
import { resolveVersion, getRuntimeVersionCached } from "./resolver"
import { fetchDistTags } from "./registry"
import { detectChannel, shouldUpdateToChannel, mapChannelToDistTag } from "./channels"
import { gt, diff } from "./semver"
import { log } from "../logger"

export interface CheckVersionOptions {
  cacheDir?: string
  localDevPath?: string
}

/**
 * Complete version check - determines if update is needed based on channel-aware logic
 *
 * This is the main entry point for version checking. It:
 * 1. Resolves the current version (runtime, cached, or local-dev)
 * 2. Detects the release channel of the current version
 * 3. Fetches all available dist-tags from npm
 * 4. Determines if an update is available
 *
 * Update logic:
 * - Stable users: only see stable updates
 * - Beta/prerelease users: see whichever is newer (beta OR stable)
 *   e.g., if on beta.2 and stable 3.0.0 releases, offer stable
 */
export async function checkVersion(options: CheckVersionOptions = {}): Promise<VersionCheckResult> {
  const resolved = resolveVersion({
    cacheDir: options.cacheDir,
    localDevPath: options.localDevPath,
  })
  const currentVersion = resolved.version
  const currentChannel = detectChannel(currentVersion)

  log(`[version] Current: ${currentVersion} (${currentChannel}) from ${resolved.source}`)

  const distTags = await fetchDistTags()

  if (!distTags) {
    log(`[version] Failed to fetch dist-tags, returning no-update result`)
    return {
      currentVersion,
      currentChannel,
      latestForChannel: null,
      latestStable: "unknown",
      needsUpdate: false,
      updateType: "none",
      availableChannels: { latest: "unknown" },
    }
  }

  const latestStable = distTags.latest ?? "unknown"

  // Find the best version to offer based on user's channel
  let latestForChannel: string | null = null

  if (currentChannel === "stable") {
    // Stable users only see stable updates
    latestForChannel = latestStable
  } else {
    // Prerelease users: offer whichever is newer - their channel's latest OR stable
    const channelTag = mapChannelToDistTag(currentChannel)
    const latestInChannel = distTags[channelTag] ?? null

    if (latestInChannel && latestStable !== "unknown") {
      // Compare channel version vs stable, offer the newer one
      latestForChannel = gt(latestStable, latestInChannel) ? latestStable : latestInChannel
      log(`[version] Beta user: comparing ${latestInChannel} (${currentChannel}) vs ${latestStable} (stable) -> offering ${latestForChannel}`)
    } else if (latestInChannel) {
      latestForChannel = latestInChannel
    } else {
      // No tag for their channel, fall back to stable
      latestForChannel = latestStable
    }
  }

  // Determine if update is needed
  let needsUpdate = false
  let updateType: VersionCheckResult["updateType"] = "none"

  if (latestForChannel && currentVersion !== "unknown" && latestForChannel !== "unknown") {
    if (gt(latestForChannel, currentVersion)) {
      needsUpdate = true
      updateType = diff(currentVersion, latestForChannel) ?? "none"
    }
  }

  log(
    `[version] Check result: ${currentVersion} (${currentChannel}) -> ${latestForChannel} | needsUpdate: ${needsUpdate} (${updateType})`
  )

  return {
    currentVersion,
    currentChannel,
    latestForChannel,
    latestStable,
    needsUpdate,
    updateType,
    availableChannels: distTags,
  }
}

/**
 * Quick check if current version is a prerelease
 */
export function isCurrentVersionPrerelease(): boolean {
  const resolved = getRuntimeVersionCached()
  const channel = detectChannel(resolved.version)
  return channel !== "stable"
}

/**
 * Get the current version string (cached for performance)
 */
export function getCurrentVersion(): string {
  return getRuntimeVersionCached().version
}

/**
 * Get detailed version info including source
 */
export function getCurrentVersionInfo() {
  return getRuntimeVersionCached()
}

/**
 * Utility to format version check result for display
 */
export function formatVersionStatus(result: VersionCheckResult): string {
  if (result.currentVersion === "unknown") {
    return "Version: Unknown"
  }

  const channelLabel = result.currentChannel === "stable" ? "" : ` (${result.currentChannel})`
  const status = result.needsUpdate
    ? `Update available: ${result.latestForChannel}`
    : "Up to date"

  return `v${result.currentVersion}${channelLabel} - ${status}`
}
