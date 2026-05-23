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
  synced: boolean
  error: "parse_error" | "write_error" | null
  message?: string
}

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/

function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (err) {
    log(`[auto-update-checker] Failed to cleanup temp file: ${filePath}`, err)
  }
}

function getIntentVersion(pluginInfo: PluginEntryInfo): string {
  if (!pluginInfo.pinnedVersion) {
    return "latest"
  }
  return pluginInfo.pinnedVersion
}

function writeCachePackageJson(
  cachePackageJsonPath: string,
  pkgJson: CachePackageJson,
): SyncResult {
  const tmpPath = `${cachePackageJsonPath}.${crypto.randomUUID()}`
  try {
    fs.mkdirSync(path.dirname(cachePackageJsonPath), { recursive: true })
    fs.writeFileSync(tmpPath, JSON.stringify(pkgJson, null, 2))
    fs.renameSync(tmpPath, cachePackageJsonPath)
    return { synced: true, error: null }
  } catch (err) {
    log("[auto-update-checker] Failed to write cache package.json:", err)
    safeUnlink(tmpPath)
    return { synced: false, error: "write_error", message: "Failed to write cache package.json" }
  }
}

export function syncCachePackageJsonToIntent(pluginInfo: PluginEntryInfo): SyncResult {
  const cachePackageJsonPath = path.join(CACHE_DIR, "package.json")
  const intentVersion = getIntentVersion(pluginInfo)

  if (!fs.existsSync(cachePackageJsonPath)) {
    log("[auto-update-checker] Cache package.json missing, creating workspace package.json", { intentVersion })
    return {
      ...writeCachePackageJson(cachePackageJsonPath, { dependencies: { [PACKAGE_NAME]: intentVersion } }),
      message: `Created cache package.json with: ${intentVersion}`,
    }
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

  if (!pkgJson || !pkgJson.dependencies?.[PACKAGE_NAME]) {
    log("[auto-update-checker] Plugin missing from cache package.json dependencies, adding dependency", { intentVersion })
    const nextPkgJson = {
      ...(pkgJson ?? {}),
      dependencies: {
        ...(pkgJson?.dependencies ?? {}),
        [PACKAGE_NAME]: intentVersion,
      },
    }
    return {
      ...writeCachePackageJson(cachePackageJsonPath, nextPkgJson),
      message: `Added ${PACKAGE_NAME}: ${intentVersion}`,
    }
  }

  const currentVersion = pkgJson.dependencies[PACKAGE_NAME]

  if (currentVersion === intentVersion) {
    log("[auto-update-checker] Cache package.json already matches intent:", intentVersion)
    return { synced: false, error: null, message: `Already matches intent: ${intentVersion}` }
  }

  const intentIsTag = !EXACT_SEMVER_REGEX.test(intentVersion.trim())
  const currentIsSemver = EXACT_SEMVER_REGEX.test(String(currentVersion).trim())

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
  return {
    ...writeCachePackageJson(cachePackageJsonPath, pkgJson),
    message: `Updated: "${currentVersion}" → "${intentVersion}"`,
  }
}
