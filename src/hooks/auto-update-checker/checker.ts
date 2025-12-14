import * as fs from "node:fs"
import * as path from "node:path"
import type { NpmDistTags, OpencodeConfig, PackageJson, UpdateCheckResult } from "./types"
import {
  PACKAGE_NAME,
  NPM_REGISTRY_URL,
  NPM_FETCH_TIMEOUT,
  INSTALLED_PACKAGE_JSON,
  USER_OPENCODE_CONFIG,
} from "./constants"
import { log } from "../../shared/logger"

export function isLocalDevMode(directory: string): boolean {
  const projectConfig = path.join(directory, ".opencode", "opencode.json")

  for (const configPath of [projectConfig, USER_OPENCODE_CONFIG]) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(content) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        if (entry.startsWith("file://") && entry.includes(PACKAGE_NAME)) {
          return true
        }
      }
    } catch {
      continue
    }
  }

  return false
}

export interface PluginEntryInfo {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
}

export function findPluginEntry(directory: string): PluginEntryInfo | null {
  const projectConfig = path.join(directory, ".opencode", "opencode.json")

  for (const configPath of [projectConfig, USER_OPENCODE_CONFIG]) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(content) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        if (entry === PACKAGE_NAME) {
          return { entry, isPinned: false, pinnedVersion: null }
        }
        if (entry.startsWith(`${PACKAGE_NAME}@`)) {
          const pinnedVersion = entry.slice(PACKAGE_NAME.length + 1)
          const isPinned = pinnedVersion !== "latest"
          return { entry, isPinned, pinnedVersion: isPinned ? pinnedVersion : null }
        }
      }
    } catch {
      continue
    }
  }

  return null
}

export function getCachedVersion(): string | null {
  try {
    if (!fs.existsSync(INSTALLED_PACKAGE_JSON)) return null
    const content = fs.readFileSync(INSTALLED_PACKAGE_JSON, "utf-8")
    const pkg = JSON.parse(content) as PackageJson
    return pkg.version ?? null
  } catch {
    return null
  }
}

export async function getLatestVersion(): Promise<string | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), NPM_FETCH_TIMEOUT)

  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    if (!response.ok) return null

    const data = (await response.json()) as NpmDistTags
    return data.latest ?? null
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function checkForUpdate(directory: string): Promise<UpdateCheckResult> {
  if (isLocalDevMode(directory)) {
    log("[auto-update-checker] Local dev mode detected, skipping update check")
    return { needsUpdate: false, currentVersion: null, latestVersion: null, isLocalDev: true, isPinned: false }
  }

  const pluginInfo = findPluginEntry(directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return { needsUpdate: false, currentVersion: null, latestVersion: null, isLocalDev: false, isPinned: false }
  }

  // Respect version pinning
  if (pluginInfo.isPinned) {
    log(`[auto-update-checker] Version pinned to ${pluginInfo.pinnedVersion}, skipping update check`)
    return { needsUpdate: false, currentVersion: pluginInfo.pinnedVersion, latestVersion: null, isLocalDev: false, isPinned: true }
  }

  const currentVersion = getCachedVersion()
  if (!currentVersion) {
    log("[auto-update-checker] No cached version found")
    return { needsUpdate: false, currentVersion: null, latestVersion: null, isLocalDev: false, isPinned: false }
  }

  const latestVersion = await getLatestVersion()
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version")
    return { needsUpdate: false, currentVersion, latestVersion: null, isLocalDev: false, isPinned: false }
  }

  const needsUpdate = currentVersion !== latestVersion
  log(`[auto-update-checker] Current: ${currentVersion}, Latest: ${latestVersion}, NeedsUpdate: ${needsUpdate}`)

  return { needsUpdate, currentVersion, latestVersion, isLocalDev: false, isPinned: false }
}
