import { join } from "node:path"
import { homedir } from "node:os"

const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:[\\/]/

export type PluginEntrySource = "npm" | "local"

export interface PluginCacheLocation {
  entry: string
  source: PluginEntrySource
  packageName: string | null
  cacheDir: string | null
  cachePackagePath: string | null
  cacheLockfilePath: string | null
  installedPackageJsonPath: string | null
}

export function getOpenCodeCacheRootPath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache")
  return join(cacheHome, "opencode")
}

export function getOpenCodePackagesCacheRootPath(): string {
  return join(getOpenCodeCacheRootPath(), "packages")
}

export function isLocalPluginEntry(entry: string): boolean {
  return (
    entry.startsWith("file://")
    || entry.startsWith(".")
    || entry.startsWith("/")
    || WINDOWS_ABSOLUTE_PATH_REGEX.test(entry)
  )
}

export function getPackageNameFromPluginEntry(entry: string): string | null {
  if (isLocalPluginEntry(entry)) {
    return null
  }

  const lastAt = entry.lastIndexOf("@")
  return lastAt > 0 ? entry.slice(0, lastAt) : entry
}

function buildInstalledPackageJsonPath(cacheDir: string, packageName: string): string {
  return join(cacheDir, "node_modules", ...packageName.split("/"), "package.json")
}

export function resolvePluginCacheLocation(entry: string): PluginCacheLocation {
  const packageName = getPackageNameFromPluginEntry(entry)
  if (!packageName) {
    return {
      entry,
      source: "local",
      packageName: null,
      cacheDir: null,
      cachePackagePath: null,
      cacheLockfilePath: null,
      installedPackageJsonPath: null,
    }
  }

  const cacheDir = join(getOpenCodePackagesCacheRootPath(), entry)
  return {
    entry,
    source: "npm",
    packageName,
    cacheDir,
    cachePackagePath: join(cacheDir, "package.json"),
    cacheLockfilePath: join(cacheDir, "package-lock.json"),
    installedPackageJsonPath: buildInstalledPackageJsonPath(cacheDir, packageName),
  }
}
