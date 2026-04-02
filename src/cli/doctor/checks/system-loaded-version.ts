import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveSymlink } from "../../../shared/file-utils"
import { getLatestVersion } from "../../../hooks/auto-update-checker/checker"
import { extractChannel } from "../../../hooks/auto-update-checker"
import { PACKAGE_NAME } from "../constants"
import { getOpenCodeCacheDir, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"

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

function resolveOpenCodeCacheDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME
  if (xdgCacheHome) return join(xdgCacheHome, "opencode")

  const fromShared = getOpenCodeCacheDir()
  const platformDefault = join(getPlatformDefaultCacheDir(), "opencode")
  if (existsSync(fromShared) || !existsSync(platformDefault)) return fromShared
  return platformDefault
}

function resolveExistingDir(dirPath: string): string {
  if (!existsSync(dirPath)) return dirPath
  return resolveSymlink(dirPath)
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

export function getLoadedPluginVersion(): LoadedVersionInfo {
  const configPaths = getOpenCodeConfigPaths({ binary: "opencode" })
  const configDir = resolveExistingDir(configPaths.configDir)
  const cacheDir = resolveExistingDir(resolveOpenCodeCacheDir())
  const candidates = [
    {
      cacheDir: configDir,
      cachePackagePath: join(configDir, "package.json"),
      installedPackagePath: join(configDir, "node_modules", PACKAGE_NAME, "package.json"),
    },
    {
      cacheDir,
      cachePackagePath: join(cacheDir, "package.json"),
      installedPackagePath: join(cacheDir, "node_modules", PACKAGE_NAME, "package.json"),
    },
  ]

  const selectedCandidate = candidates.find((candidate) => existsSync(candidate.installedPackagePath)) ?? candidates[0]

  const { cacheDir: selectedDir, cachePackagePath, installedPackagePath } = selectedCandidate

  const cachePackage = readPackageJson(cachePackagePath)
  const installedPackage = readPackageJson(installedPackagePath)

  const expectedVersion = normalizeVersion(cachePackage?.dependencies?.[PACKAGE_NAME])
  const loadedVersion = normalizeVersion(installedPackage?.version)

  return {
    cacheDir: selectedDir,
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
