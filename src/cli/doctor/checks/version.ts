import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { CheckResult, CheckDefinition, VersionCheckInfo } from "../types"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../constants"
import { parseJsonc } from "../../../shared"

const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode")
const OPENCODE_PACKAGE_JSON = join(OPENCODE_CONFIG_DIR, "package.json")
const OPENCODE_JSON = join(OPENCODE_CONFIG_DIR, "opencode.json")
const OPENCODE_JSONC = join(OPENCODE_CONFIG_DIR, "opencode.jsonc")

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version: string }
    return data.version
  } catch {
    return null
  }
}

function getCurrentVersion(): {
  version: string | null
  isLocalDev: boolean
  isPinned: boolean
  pinnedVersion: string | null
} {
  const configPath = existsSync(OPENCODE_JSONC) ? OPENCODE_JSONC : OPENCODE_JSON

  if (!existsSync(configPath)) {
    return { version: null, isLocalDev: false, isPinned: false, pinnedVersion: null }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const config = parseJsonc<{ plugin?: string[] }>(content)
    const plugins = config.plugin ?? []

    for (const plugin of plugins) {
      if (plugin.startsWith("file:") && plugin.includes(PACKAGE_NAME)) {
        return { version: "local-dev", isLocalDev: true, isPinned: false, pinnedVersion: null }
      }
      if (plugin.startsWith(`${PACKAGE_NAME}@`)) {
        const pinnedVersion = plugin.split("@")[1]
        return { version: pinnedVersion, isLocalDev: false, isPinned: true, pinnedVersion }
      }
      if (plugin === PACKAGE_NAME) {
        if (existsSync(OPENCODE_PACKAGE_JSON)) {
          try {
            const pkgContent = readFileSync(OPENCODE_PACKAGE_JSON, "utf-8")
            const pkg = JSON.parse(pkgContent) as { dependencies?: Record<string, string> }
            const depVersion = pkg.dependencies?.[PACKAGE_NAME]
            if (depVersion) {
              const cleanVersion = depVersion.replace(/^[\^~]/, "")
              return { version: cleanVersion, isLocalDev: false, isPinned: false, pinnedVersion: null }
            }
          } catch {
            // intentionally empty - parse errors ignored
          }
        }
        return { version: null, isLocalDev: false, isPinned: false, pinnedVersion: null }
      }
    }

    return { version: null, isLocalDev: false, isPinned: false, pinnedVersion: null }
  } catch {
    return { version: null, isLocalDev: false, isPinned: false, pinnedVersion: null }
  }
}

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
  const current = getCurrentVersion()
  const latestVersion = await fetchLatestVersion()

  const isUpToDate =
    current.isLocalDev ||
    current.isPinned ||
    !current.version ||
    !latestVersion ||
    compareVersions(current.version, latestVersion)

  return {
    currentVersion: current.version,
    latestVersion,
    isUpToDate,
    isLocalDev: current.isLocalDev,
    isPinned: current.isPinned,
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
