import { existsSync } from "node:fs"

import {
  resolvePluginCacheLocation,
  type PluginCacheLocation,
} from "./plugin-cache-entry"

export type PluginCacheStatus = "healthy" | "missing" | "corrupt" | "local"

export interface PluginCacheInspection {
  entry: string
  status: PluginCacheStatus
  location: PluginCacheLocation
  requiredPaths: string[]
  missingPaths: string[]
}

function getRequiredPaths(location: PluginCacheLocation): string[] {
  return [
    location.cachePackagePath,
    location.cacheLockfilePath,
    location.installedPackageJsonPath,
  ].filter((pathValue): pathValue is string => Boolean(pathValue))
}

export function inspectPluginCache(entry: string): PluginCacheInspection {
  const location = resolvePluginCacheLocation(entry)
  if (location.source === "local") {
    return {
      entry,
      status: "local",
      location,
      requiredPaths: [],
      missingPaths: [],
    }
  }

  const requiredPaths = getRequiredPaths(location)
  const missingPaths = requiredPaths.filter((pathValue) => !existsSync(pathValue))
  const cacheDirExists = location.cacheDir ? existsSync(location.cacheDir) : false
  const status = !cacheDirExists
    ? "missing"
    : missingPaths.length === 0
      ? "healthy"
      : "corrupt"

  return {
    entry,
    status,
    location,
    requiredPaths,
    missingPaths,
  }
}
