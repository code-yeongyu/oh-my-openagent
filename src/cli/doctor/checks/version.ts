import type { CheckResult, CheckDefinition, VersionCheckInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import {
  getCachedVersion,
  getLatestVersion,
  isLocalDevMode,
  findPluginEntry,
} from "../../../hooks/auto-update-checker/checker"

function compareVersions(current: string, latest: string): boolean {
  const parseVersion = (v: string): number[] => {
    const cleaned = v.replace(/^v/, "").split("-")[0]
    return cleaned.split(".").map((n) => parseInt(n, 10) || 0)
  }

  const curr = parseVersion(current)
  const lat = parseVersion(latest)

  for (let i = 0; i < Math.max(curr.length, lat.length); i++) {
    const c = curr[i] ?? 0
    const l = lat[i] ?? 0
    if (c < l) return false
    if (c > l) return true
  }
  return true
}

export async function getVersionInfo(): Promise<VersionCheckInfo> {
  const cwd = process.cwd()

  if (isLocalDevMode(cwd)) {
    return {
      currentVersion: "local-dev",
      latestVersion: null,
      isUpToDate: true,
      isLocalDev: true,
      isPinned: false,
    }
  }

  const pluginInfo = findPluginEntry(cwd)
  if (pluginInfo?.isPinned) {
    return {
      currentVersion: pluginInfo.pinnedVersion,
      latestVersion: null,
      isUpToDate: true,
      isLocalDev: false,
      isPinned: true,
    }
  }

  const currentVersion = getCachedVersion()
  const { extractChannel } = await import("../../../hooks/auto-update-checker/index")
  const channel = extractChannel(pluginInfo?.pinnedVersion ?? currentVersion)
  const latestVersion = await getLatestVersion(channel)

  const isUpToDate =
    !currentVersion ||
    !latestVersion ||
    compareVersions(currentVersion, latestVersion)

  return {
    currentVersion,
    latestVersion,
    isUpToDate,
    isLocalDev: false,
    isPinned: false,
  }
}

export async function checkVersionStatus(): Promise<CheckResult> {
  const info = await getVersionInfo()

  if (info.isLocalDev) {
    return {
      name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
      status: "pass",
      message: "Running in local development mode",
      details: ["Using file:// protocol from config"],
    }
  }

  if (info.isPinned) {
    return {
      name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
      status: "pass",
      message: `Pinned to version ${info.currentVersion}`,
      details: ["Update check skipped for pinned versions"],
    }
  }

  if (!info.currentVersion) {
    return {
      name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
      status: "warn",
      message: "Unable to determine current version",
      details: ["Run: bunx oh-my-opencode get-local-version"],
    }
  }

  if (!info.latestVersion) {
    return {
      name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
      status: "warn",
      message: `Current: ${info.currentVersion}`,
      details: ["Unable to check for updates (network error)"],
    }
  }

  if (!info.isUpToDate) {
    return {
      name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
      status: "warn",
      message: `Update available: ${info.currentVersion} -> ${info.latestVersion}`,
      details: ["Run: cd ~/.config/opencode && bun update oh-my-opencode"],
    }
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
    status: "pass",
    message: `Up to date (${info.currentVersion})`,
    details: info.latestVersion ? [`Latest: ${info.latestVersion}`] : undefined,
  }
}

export function getVersionCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.VERSION_STATUS,
    name: CHECK_NAMES[CHECK_IDS.VERSION_STATUS],
    category: "updates",
    check: checkVersionStatus,
    critical: false,
  }
}
