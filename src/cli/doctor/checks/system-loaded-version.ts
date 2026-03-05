import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { getLatestVersion } from "../../../hooks/auto-update-checker/checker"
import { extractChannel } from "../../../hooks/auto-update-checker"
import { PACKAGE_NAME } from "../constants"
import { getOpenCodeConfigDir, parseJsonc } from "../../../shared"

interface PackageJsonShape {
  version?: string
  dependencies?: Record<string, string>
}

export interface LoadedVersionInfo {
  cacheDir: string
  cachePackagePath: string
  installedPackagePath: string
  expectedVersion: string | null
  loadedVersion: string | null
}

function getPlatformDefaultCacheDir(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") return join(homedir(), "Library", "Caches")
  if (platform === "win32") return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
  return join(homedir(), ".cache")
}

function readPackageJson(filePath: string): PackageJsonShape | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    return parseJsonc<PackageJsonShape>(content)
  } catch {
    return null
  }
}

function normalizeVersion(value: string | undefined): string | null {
  if (!value) return null
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return match?.[0] ?? null
}

function resolvePluginInstallDir(): string {
  // 1. Config directory (primary install location)
  const configDir = getOpenCodeConfigDir({ binary: "opencode", version: null })
  const configInstalled = join(configDir, "node_modules", PACKAGE_NAME, "package.json")
  if (existsSync(configInstalled)) return configDir

  // 2. XDG_CACHE_HOME override (per XDG spec, takes precedence over defaults)
  const xdgCacheHome = process.env.XDG_CACHE_HOME
  if (xdgCacheHome) {
    const xdgDir = join(xdgCacheHome, "opencode")
    if (existsSync(join(xdgDir, "node_modules", PACKAGE_NAME, "package.json"))) return xdgDir
  }

  // 3. Default XDG cache path (covers macOS users without XDG_CACHE_HOME)
  const defaultXdgCache = join(homedir(), ".cache", "opencode")
  if (existsSync(join(defaultXdgCache, "node_modules", PACKAGE_NAME, "package.json"))) return defaultXdgCache

  // 4. Platform-specific cache directory (~/Library/Caches on macOS, etc.)
  const cacheDir = join(getPlatformDefaultCacheDir(), "opencode")
  const cacheInstalled = join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")
  if (existsSync(cacheInstalled)) return cacheDir

  return configDir
}

export function getLoadedPluginVersion(): LoadedVersionInfo {
  const cacheDir = resolvePluginInstallDir()
  const cachePackagePath = join(cacheDir, "package.json")
  const installedPackagePath = join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")

  const cachePackage = readPackageJson(cachePackagePath)
  const installedPackage = readPackageJson(installedPackagePath)

  const expectedVersion = normalizeVersion(cachePackage?.dependencies?.[PACKAGE_NAME])
  const loadedVersion = normalizeVersion(installedPackage?.version)

  return {
    cacheDir,
    cachePackagePath,
    installedPackagePath,
    expectedVersion,
    loadedVersion,
  }
}

export async function getLatestPluginVersion(currentVersion: string | null): Promise<string | null> {
  const channel = extractChannel(currentVersion)
  return getLatestVersion(channel)
}

export function getSuggestedInstallTag(currentVersion: string | null): string {
  return extractChannel(currentVersion)
}
