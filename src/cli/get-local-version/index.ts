import { getCachedVersion, getLatestVersion, isLocalDevMode, findPluginEntry } from "../../hooks/auto-update-checker/checker"
import type { GetLocalVersionOptions, VersionInfo } from "./types"
import { formatVersionOutput, formatJsonOutput } from "./formatter"

export async function getLocalVersion(options: GetLocalVersionOptions = {}): Promise<number> {
  const directory = options.directory ?? process.cwd()
  
  try {
    if (isLocalDevMode(directory)) {
      const currentVersion = getCachedVersion()
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: true,
        isPinned: false,
        pinnedVersion: null,
        status: "local-dev",
      }
      
      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    const pluginInfo = findPluginEntry(directory)
    if (pluginInfo?.isPinned) {
      const info: VersionInfo = {
        currentVersion: pluginInfo.pinnedVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: true,
        pinnedVersion: pluginInfo.pinnedVersion,
        status: "pinned",
      }
      
      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    const currentVersion = getCachedVersion()
    if (!currentVersion) {
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

    const { extractChannel } = await import("../../hooks/auto-update-checker/index")
    const channel = extractChannel(pluginInfo?.pinnedVersion ?? currentVersion)
    const latestVersion = await getLatestVersion(channel)
    
    if (!latestVersion) {
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: false,
        pinnedVersion: null,
        status: "error",
      }
      
      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
    }

    const isUpToDate = currentVersion === latestVersion
    const info: VersionInfo = {
      currentVersion,
      latestVersion,
      isUpToDate,
      isLocalDev: false,
      isPinned: false,
      pinnedVersion: null,
      status: isUpToDate ? "up-to-date" : "outdated",
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
