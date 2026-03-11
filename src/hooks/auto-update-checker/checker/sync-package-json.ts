import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { CACHE_DIR, PACKAGE_NAME } from "../constants"
import { log } from "../../../shared/logger"
import type { PluginEntryInfo } from "./plugin-entry"

interface CachePackageJson {
  dependencies?: Record<string, string>
}

export interface SyncResult {
  /** Whether the package.json was successfully synced/updated */
  synced: boolean
  /** Whether there was an error during sync (null if no error) */
  error: "file_not_found" | "plugin_not_in_deps" | "parse_error" | "write_error" | null
  /** Human-readable message describing what happened */
  message?: string
}

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (err) {
    log(`[auto-update-checker] Failed to cleanup temp file: ${filePath}`, err)
  }
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
 * @returns SyncResult with synced status and any error information
 */
export function syncCachePackageJsonToIntent(pluginInfo: PluginEntryInfo): SyncResult {
  const cachePackageJsonPath = path.join(CACHE_DIR, "package.json")

  if (!fs.existsSync(cachePackageJsonPath)) {
    log("[auto-update-checker] Cache package.json not found, nothing to sync")
    return { synced: false, error: "file_not_found", message: "Cache package.json not found" }
  }

  let content: string
  let pkgJson: CachePackageJson

  try {
    content = fs.readFileSync(cachePackageJsonPath, "utf-8")
  } catch (err) {
    log("[auto-update-checker] Failed to read cache package.json:", err)
    return { synced: false, error: "parse_error", message: "Failed to read cache package.json" }
  }

  try {
    pkgJson = JSON.parse(content) as CachePackageJson
  } catch (err) {
    log("[auto-update-checker] Failed to parse cache package.json:", err)
    return { synced: false, error: "parse_error", message: "Failed to parse cache package.json (malformed JSON)" }
  }

  if (!pkgJson.dependencies?.[PACKAGE_NAME]) {
    log("[auto-update-checker] Plugin not in cache package.json dependencies, nothing to sync")
    return { synced: false, error: "plugin_not_in_deps", message: "Plugin not in cache package.json dependencies" }
  }

  const currentVersion = pkgJson.dependencies[PACKAGE_NAME]
  const intentVersion = getIntentVersion(pluginInfo)

  if (currentVersion === intentVersion) {
    log("[auto-update-checker] Cache package.json already matches intent:", intentVersion)
    return { synced: false, error: null, message: `Already matches intent: ${intentVersion}` }
  }

  // Check if this is a meaningful change:
  // - If intent is a tag (latest, next, beta) and current is semver, we need to update
  // - If both are semver but different, user explicitly changed versions
  const intentIsTag = !EXACT_SEMVER_REGEX.test(intentVersion.trim())
  const currentIsSemver = EXACT_SEMVER_REGEX.test(currentVersion.trim())

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

  const tmpPath = `${cachePackageJsonPath}.${crypto.randomUUID()}`
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(pkgJson, null, 2))
    fs.renameSync(tmpPath, cachePackageJsonPath)
    return { synced: true, error: null, message: `Updated: "${currentVersion}" → "${intentVersion}"` }
  } catch (err) {
    log("[auto-update-checker] Failed to write cache package.json:", err)
    safeUnlink(tmpPath)
    return { synced: false, error: "write_error", message: "Failed to write cache package.json" }
  }
}
