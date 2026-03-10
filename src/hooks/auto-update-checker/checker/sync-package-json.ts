import * as fs from "node:fs"
import * as path from "node:path"
import { CACHE_DIR, PACKAGE_NAME } from "../constants"
import { log } from "../../../shared/logger"
import type { PluginEntryInfo } from "./plugin-entry"

interface CachePackageJson {
  dependencies?: Record<string, string>
}

/**
 * Determine the version specifier to use in cache package.json based on opencode.json intent.
 *
 * - "oh-my-opencode" (no version) → "latest"
 * - "oh-my-opencode@latest" → "latest"
 * - "oh-my-opencode@next" → "next"
 * - "oh-my-opencode@3.10.0" → "3.10.0" (pinned, use as-is)
 */
function getIntentVersion(pluginInfo: PluginEntryInfo): string {
  if (!pluginInfo.pinnedVersion) {
    // No version specified in opencode.json, default to latest
    return "latest"
  }
  return pluginInfo.pinnedVersion
}

/**
 * Sync the cache package.json to match the opencode.json plugin intent.
 *
 * OpenCode pins resolved versions in cache package.json (e.g., "3.11.0" instead of "latest").
 * This causes issues when users switch from pinned to tag in opencode.json:
 * - User changes opencode.json from "oh-my-opencode@3.10.0" to "oh-my-opencode@latest"
 * - Cache package.json still has "3.10.0"
 * - bun install reinstalls 3.10.0 instead of resolving @latest
 *
 * This function updates cache package.json to match the user's intent before bun install.
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

    // Check if this is a meaningful change:
    // - If intent is a tag (latest, next, beta) and current is semver, we need to update
    // - If both are semver but different, user explicitly changed versions
    const intentIsTag = !/^\d+\.\d+\.\d+/.test(intentVersion)
    const currentIsSemver = /^\d+\.\d+\.\d+/.test(currentVersion)

    if (intentIsTag && currentIsSemver) {
      log(
        `[auto-update-checker] Syncing cache package.json: "${currentVersion}" → "${intentVersion}" (opencode.json intent)`
      )
    } else {
      log(
        `[auto-update-checker] Updating cache package.json: "${currentVersion}" → "${intentVersion}"`
      )
    }

    pkgJson.dependencies[PACKAGE_NAME] = intentVersion
    fs.writeFileSync(cachePackageJsonPath, JSON.stringify(pkgJson, null, 2))
    return true
  } catch (err) {
    log("[auto-update-checker] Failed to sync cache package.json:", err)
    return false
  }
}
