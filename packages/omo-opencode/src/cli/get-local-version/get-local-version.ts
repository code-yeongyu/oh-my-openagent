import {
  findPluginEntry,
  getCachedVersion,
  getLatestVersion,
  getLocalDevVersion,
  isLocalDevMode,
} from "../../hooks/auto-update-checker/checker"

import type { GetLocalVersionOptions, VersionInfo } from "./types"
import { formatJsonOutput, formatVersionOutput } from "./formatter"

export async function getLocalVersion(
  options: GetLocalVersionOptions = {}
): Promise<number> {
  const directory = options.directory ?? process.cwd()

  try {
    if (isLocalDevMode(directory)) {
      const currentVersion = getLocalDevVersion(directory) ?? getCachedVersion()
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
      const actualVersion = getCachedVersion()
      const isMismatch = actualVersion !== null && actualVersion !== pluginInfo.pinnedVersion
      const info: VersionInfo = {
        currentVersion: isMismatch ? actualVersion : pluginInfo.pinnedVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: false,
        isPinned: true,
        pinnedVersion: pluginInfo.pinnedVersion,
        status: isMismatch ? "pinned-mismatch" : "pinned",
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

    if (!/^\d+\.\d+\.\d+/.test(currentVersion)) {
      const info: VersionInfo = {
        currentVersion,
        latestVersion: null,
        isUpToDate: false,
        isLocalDev: true,
        isPinned: false,
        pinnedVersion: null,
        status: "dev",
      }

      console.log(options.json ? formatJsonOutput(info) : formatVersionOutput(info))
      return 0
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
