import * as fs from "node:fs"
import * as path from "node:path"
import { CACHE_DIR, PACKAGE_NAME } from "../constants"
import { log } from "../../../shared/logger"
import type { PluginEntryInfo } from "./plugin-entry"

interface CachePackageJson {
  dependencies?: Record<string, string>
}

function getIntentVersion(pluginInfo: PluginEntryInfo): string {
  if (!pluginInfo.pinnedVersion) {
    return "latest"
  }
  return pluginInfo.pinnedVersion
}

/**
 * Sync cache package.json to match opencode.json plugin intent before bun install.
 *
 * OpenCode pins resolved versions in cache package.json (e.g., "3.11.0" instead of "latest").
 * When auto-update detects a newer version and runs `bun install`, it re-resolves the pinned
 * version instead of the user's declared tag, causing updates to silently fail.
 *
 * @returns true if package.json was updated, false otherwise
 */
export function syncCachePackageJsonToIntent(pluginInfo: PluginEntryInfo): boolean {
  const cachePackageJsonPath = path.join(CACHE_DIR, "package.json")

  if (!fs.existsSync(cachePackageJsonPath)) {
    log("[auto-update-checker] Cache package.json not found, nothing to sync")
    return false
  }

  try {
    const content = fs.readFileSync(cachePackageJsonPath, "utf-8")
    const pkgJson = JSON.parse(content) as CachePackageJson

    if (!pkgJson.dependencies?.[PACKAGE_NAME]) {
      log("[auto-update-checker] Plugin not in cache package.json dependencies, nothing to sync")
      return false
    }

    const currentVersion = pkgJson.dependencies[PACKAGE_NAME]
    const intentVersion = getIntentVersion(pluginInfo)

    if (currentVersion === intentVersion) {
      log("[auto-update-checker] Cache package.json already matches intent:", intentVersion)
      return false
    }

    log(
      `[auto-update-checker] Syncing cache package.json: "${currentVersion}" → "${intentVersion}"`
    )

    pkgJson.dependencies[PACKAGE_NAME] = intentVersion
    fs.writeFileSync(cachePackageJsonPath, JSON.stringify(pkgJson, null, 2))
    return true
  } catch (err) {
    log("[auto-update-checker] Failed to sync cache package.json:", err)
    return false
  }
}
