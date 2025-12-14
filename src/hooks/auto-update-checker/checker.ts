import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
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
  return getLocalDevPath(directory) !== null
}

function stripJsonComments(json: string): string {
  return json.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1")
}

export function getLocalDevPath(directory: string): string | null {
  const projectConfig = path.join(directory, ".opencode", "opencode.json")

  for (const configPath of [projectConfig, USER_OPENCODE_CONFIG]) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        if (entry.startsWith("file://") && entry.includes(PACKAGE_NAME)) {
          return entry.replace("file://", "")
        }
      }
    } catch {
      continue
    }
  }

  return null
}

function findPackageJsonUp(startPath: string): string | null {
  try {
    const stat = fs.statSync(startPath)
    let dir = stat.isDirectory() ? startPath : path.dirname(startPath)
    
    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, "package.json")
      if (fs.existsSync(pkgPath)) {
        try {
          const content = fs.readFileSync(pkgPath, "utf-8")
          const pkg = JSON.parse(content) as PackageJson
          if (pkg.name === PACKAGE_NAME) return pkgPath
        } catch {}
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {}
  return null
}

export function getLocalDevVersion(directory: string): string | null {
  const localPath = getLocalDevPath(directory)
  if (!localPath) return null

  try {
    const pkgPath = findPackageJsonUp(localPath)
    if (!pkgPath) return null
    const content = fs.readFileSync(pkgPath, "utf-8")
    const pkg = JSON.parse(content) as PackageJson
    return pkg.version ?? null
  } catch {
    return null
  }
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
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
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
    if (fs.existsSync(INSTALLED_PACKAGE_JSON)) {
      const content = fs.readFileSync(INSTALLED_PACKAGE_JSON, "utf-8")
      const pkg = JSON.parse(content) as PackageJson
      if (pkg.version) return pkg.version
    }
  } catch {}

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = findPackageJsonUp(currentDir)
    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content) as PackageJson
      if (pkg.version) return pkg.version
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from current directory:", err)
  }

  return null
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
