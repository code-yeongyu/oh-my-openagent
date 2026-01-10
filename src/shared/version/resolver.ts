/**
 * Runtime version resolution
 *
 * Resolves the current version at RUNTIME by finding package.json,
 * avoiding the build-time bundling issue where version gets frozen.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { VersionResolveResult } from "./types"
import { log } from "../logger"

const PACKAGE_NAME = "oh-my-opencode"

/**
 * Find package.json by walking up from a starting path
 */
function findPackageJsonUp(startPath: string): string | null {
  try {
    const stat = fs.statSync(startPath)
    let dir = stat.isDirectory() ? startPath : path.dirname(startPath)

    for (let i = 0; i < 10; i++) {
      const pkgPath = path.join(dir, "package.json")

      if (fs.existsSync(pkgPath)) {
        try {
          const content = fs.readFileSync(pkgPath, "utf-8")
          const pkg = JSON.parse(content)
          if (pkg.name === PACKAGE_NAME) return pkgPath
        } catch {
          // Invalid JSON, continue searching
        }
      }

      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // Stat failed
  }

  return null
}

/**
 * Resolve version at RUNTIME by finding package.json relative to this file.
 * This avoids the build-time bundling issue.
 */
export function resolveRuntimeVersion(): VersionResolveResult {
  try {
    // Get directory of this file at runtime
    const currentFile = fileURLToPath(import.meta.url)
    const currentDir = path.dirname(currentFile)

    const pkgPath = findPackageJsonUp(currentDir)

    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content)

      if (pkg.version) {
        log(`[version/resolver] Found runtime version: ${pkg.version} at ${pkgPath}`)
        return {
          version: pkg.version,
          source: "runtime",
          path: pkgPath,
        }
      }
    }

    log(`[version/resolver] Could not find package.json for ${PACKAGE_NAME}`)
    return { version: "unknown", source: "unknown" }
  } catch (err) {
    log(`[version/resolver] Error resolving runtime version:`, err)
    return { version: "unknown", source: "unknown" }
  }
}

/**
 * Get version from OpenCode's plugin cache directory
 */
export function getCachedVersion(cacheDir: string): VersionResolveResult {
  const pkgPath = path.join(cacheDir, "node_modules", PACKAGE_NAME, "package.json")

  try {
    if (fs.existsSync(pkgPath)) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content)

      if (pkg.version) {
        log(`[version/resolver] Found cached version: ${pkg.version} at ${pkgPath}`)
        return {
          version: pkg.version,
          source: "cached",
          path: pkgPath,
        }
      }
    }
  } catch (err) {
    log(`[version/resolver] Error reading cached version:`, err)
  }

  return { version: "unknown", source: "unknown" }
}

/**
 * Get version from a local development path (file:// protocol)
 */
export function getLocalDevVersion(localPath: string): VersionResolveResult {
  try {
    const pkgPath = findPackageJsonUp(localPath)

    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content)

      if (pkg.version) {
        log(`[version/resolver] Found local dev version: ${pkg.version} at ${pkgPath}`)
        return {
          version: pkg.version,
          source: "local-dev",
          path: pkgPath,
        }
      }
    }
  } catch (err) {
    log(`[version/resolver] Error reading local dev version:`, err)
  }

  return { version: "unknown", source: "unknown" }
}

/**
 * Main version resolver - tries multiple sources in priority order
 */
export function resolveVersion(options: {
  cacheDir?: string
  localDevPath?: string
  preferRuntime?: boolean
} = {}): VersionResolveResult {
  const { cacheDir, localDevPath, preferRuntime = true } = options

  // Local dev takes highest priority
  if (localDevPath) {
    const localDev = getLocalDevVersion(localDevPath)
    if (localDev.source === "local-dev") return localDev
  }

  // Runtime resolution (from this package's location)
  if (preferRuntime) {
    const runtime = resolveRuntimeVersion()
    if (runtime.source === "runtime") return runtime
  }

  // Cached version from OpenCode's plugin cache
  if (cacheDir) {
    const cached = getCachedVersion(cacheDir)
    if (cached.source === "cached") return cached
  }

  // Fallback to runtime if cache failed
  if (!preferRuntime) {
    return resolveRuntimeVersion()
  }

  return { version: "unknown", source: "unknown" }
}

// Cache the runtime version to avoid repeated filesystem access
let cachedRuntimeVersion: VersionResolveResult | null = null

/**
 * Get runtime version with caching (for performance)
 */
export function getRuntimeVersionCached(): VersionResolveResult {
  if (!cachedRuntimeVersion) {
    cachedRuntimeVersion = resolveRuntimeVersion()
  }
  return cachedRuntimeVersion
}

/**
 * Clear the runtime version cache (useful after updates)
 */
export function clearRuntimeVersionCache(): void {
  cachedRuntimeVersion = null
}
