import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveSymlink } from "../../../shared/file-utils"
import { getLatestVersion } from "../../../hooks/auto-update-checker/checker"
import { extractChannel } from "../../../hooks/auto-update-checker"
import { findPackageJsonUp } from "../../../hooks/auto-update-checker/checker/package-json-locator"
import { PACKAGE_NAME } from "../framework/constants"
import { ACCEPTED_PACKAGE_NAMES, getOpenCodeCacheDir, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"

interface PackageJsonShape {
  version?: string
  dependencies?: Record<string, string>
}

interface PackageCandidate {
  packageName: string
  installedPackagePath: string
}

interface InstallCandidate {
  cacheDir: string
  cachePackagePath: string
  packageCandidates: PackageCandidate[]
  specifier?: string
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
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
}

function normalizeVersion(value: string | undefined): string | null {
  if (!value) return null
  const match = value.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)
  return match?.[0] ?? null
}

function createPackageCandidates(rootDir: string): PackageCandidate[] {
  return ACCEPTED_PACKAGE_NAMES.map((packageName) => ({
    packageName,
    installedPackagePath: join(rootDir, "node_modules", packageName, "package.json"),
  }))
}

function createTaggedInstallCandidates(rootDir: string): InstallCandidate[] {
  const packagesDir = join(rootDir, "packages")
  if (!existsSync(packagesDir)) return []

  const candidates: InstallCandidate[] = []
  for (const entryName of readdirSync(packagesDir).sort()) {
    const packageName = ACCEPTED_PACKAGE_NAMES.find((name) => entryName.startsWith(`${name}@`))
    if (packageName === undefined) continue
    const installDir = join(packagesDir, entryName)
    candidates.push({
      cacheDir: installDir,
      cachePackagePath: join(installDir, "package.json"),
      specifier: entryName,
      packageCandidates: [
        {
          packageName,
          installedPackagePath: join(installDir, "node_modules", packageName, "package.json"),
        },
      ],
    })
  }
  return candidates
}

function selectInstalledPackage(candidate: InstallCandidate): PackageCandidate {
  return candidate.packageCandidates.find((packageCandidate) => existsSync(packageCandidate.installedPackagePath))
    ?? candidate.packageCandidates[0]
}

function getExpectedVersion(cachePackage: PackageJsonShape | null, packageName: string): string | null {
  return normalizeVersion(cachePackage?.dependencies?.[packageName])
    ?? normalizeVersion(cachePackage?.dependencies?.[PACKAGE_NAME])
}

function resolveInstalledPackageJsonPath(): { packageName: string; packageJsonPath: string } | null {
  try {
    const require = createRequire(import.meta.url)
    for (const packageName of ACCEPTED_PACKAGE_NAMES) {
      try {
        const packageJsonPath = require.resolve(`${packageName}/package.json`)
        if (existsSync(packageJsonPath)) {
          return { packageName, packageJsonPath }
        }
      } catch {
        continue
      }
    }
    const ownPackageJsonPath = findPackageJsonUp(fileURLToPath(import.meta.url))
    if (ownPackageJsonPath) {
      return { packageName: PACKAGE_NAME, packageJsonPath: ownPackageJsonPath }
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return null
  }
  return null
}

function getInstallCandidates(): InstallCandidate[] {
  const configPaths = getOpenCodeConfigPaths({ binary: "opencode" })
  const configDir = resolveExistingDir(configPaths.configDir)
  const cacheDir = resolveExistingDir(resolveOpenCodeCacheDir())
  return [
    {
      cacheDir: configDir,
      cachePackagePath: join(configDir, "package.json"),
      packageCandidates: createPackageCandidates(configDir),
    },
    ...createTaggedInstallCandidates(configDir),
    {
      cacheDir,
      cachePackagePath: join(cacheDir, "package.json"),
      packageCandidates: createPackageCandidates(cacheDir),
    },
    ...createTaggedInstallCandidates(cacheDir),
  ]
}

function findInstalledCandidate(candidates: InstallCandidate[]): InstallCandidate | undefined {
  return candidates.find((candidate) => candidate.packageCandidates.some((pkg) => existsSync(pkg.installedPackagePath)))
}

export function findOpenCodeInstalledPluginPackage(pin?: { specifier: string; version: string }): string | null {
  const candidates = getInstallCandidates()
  if (!pin) {
    const candidate = findInstalledCandidate(candidates)
    return candidate ? selectInstalledPackage(candidate).installedPackagePath : null
  }

  const tagged = findInstalledCandidate(candidates.filter((candidate) => candidate.specifier === pin.specifier))
  if (tagged) return selectInstalledPackage(tagged).installedPackagePath

  const packageName = pin.specifier.slice(0, -(pin.version.length + 1))
  for (const candidate of candidates) {
    if (candidate.specifier) continue
    const pkg = candidate.packageCandidates.find((pkg) => pkg.packageName === packageName)
    if (pkg && readPackageJson(pkg.installedPackagePath)?.version === pin.version) return pkg.installedPackagePath
  }
  return null
}

export function getLoadedPluginVersion(): LoadedVersionInfo {
  const candidates = getInstallCandidates()
  const selectedCandidate = findInstalledCandidate(candidates) ?? candidates[0]

  const { cacheDir: selectedDir, cachePackagePath } = selectedCandidate
  const selectedPackage = selectInstalledPackage(selectedCandidate)
  const candidateInstalledPath = selectedPackage.installedPackagePath
  const candidateExists = existsSync(candidateInstalledPath)

  const resolvedFallback = candidateExists ? null : resolveInstalledPackageJsonPath()
  const installedPackagePath = resolvedFallback?.packageJsonPath ?? candidateInstalledPath
  const resolvedPackageName = resolvedFallback?.packageName ?? selectedPackage.packageName

  const cachePackage = readPackageJson(cachePackagePath)
  const installedPackage = readPackageJson(installedPackagePath)

  const expectedVersion = getExpectedVersion(cachePackage, resolvedPackageName)
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
