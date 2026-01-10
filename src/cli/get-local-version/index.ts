import { findPluginEntry } from "../../hooks/auto-update-checker/checker"
import { CACHE_DIR } from "../../hooks/auto-update-checker/constants"
import { checkVersion, detectChannel } from "../../shared/version"
import type { GetLocalVersionOptions, VersionInfo } from "./types"
import { formatVersionOutput, formatJsonOutput } from "./formatter"

export async function getLocalVersion(options: GetLocalVersionOptions = {}): Promise<number> {
  const directory = options.directory ?? process.cwd()

  try {
    const pluginInfo = findPluginEntry(directory)
    
    // Check for local dev mode (file:// protocol)
    const isLocalDev = pluginInfo?.entry.startsWith("file://") ?? false

    if (isLocalDev) {
      // Use the new version system even for local dev
      const result = await checkVersion({ cacheDir: CACHE_DIR })
      const info: VersionInfo = {
        currentVersion: result.currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: true,
        isPinned: false,
        pinnedVersion: null,
        status: "local-dev",
        currentChannel: result.currentChannel,
      }

      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    // Check for pinned version (but still show channel info)
    if (pluginInfo?.isPinned) {
      const pinnedChannel = detectChannel(pluginInfo.pinnedVersion ?? "")
      const info: VersionInfo = {
        currentVersion: pluginInfo.pinnedVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: true,
        pinnedVersion: pluginInfo.pinnedVersion,
        status: "pinned",
        currentChannel: pinnedChannel,
      }

      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    // Full version check using new system
    const result = await checkVersion({ cacheDir: CACHE_DIR })

    if (result.currentVersion === "unknown") {
      const info: VersionInfo = {
        currentVersion: null,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: false,
        pinnedVersion: null,
        status: "unknown",
      }

      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 1
    }

    if (!result.latestForChannel) {
      const info: VersionInfo = {
        currentVersion: result.currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: false,
        pinnedVersion: null,
        status: "error",
        currentChannel: result.currentChannel,
      }

      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    const info: VersionInfo = {
      currentVersion: result.currentVersion,
      latestVersion: result.latestStable,
      isUpToDate: !result.needsUpdate,
      isLocalDev: false,
      isPinned: false,
      pinnedVersion: null,
      status: result.needsUpdate ? "outdated" : "up-to-date",
      currentChannel: result.currentChannel,
      latestForChannel: result.latestForChannel,
      updateType: result.updateType,
      availableChannels: result.availableChannels,
    }

    console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
    return 0
  } catch (error) {
    const info: VersionInfo = {
      currentVersion: null,
      latestVersion: null,
      isUpToDate: false,
      isLocalDev: false,
      isPinned: false,
      pinnedVersion: null,
      status: "error",
    }

    console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
    return 1
  }
}

export * from "./types"
