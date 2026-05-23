import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../../../shared/logger"
import { CACHE_DIR } from "../constants"
import { findPackageJsonUp } from "./package-json-locator"

interface SandboxWorkspaceOptions {
  currentDir?: string | null
  findPackageJson?: (startPath: string) => string | null
  cacheDir?: string
  existsSync?: (p: string) => boolean
}

/**
 * Resolves the directory where the currently-loaded plugin lives so that
 * `bun install` targets the same sandbox the runtime actually loaded from.
 *
 * OpenCode's `Npm.add()` installs each plugin into a per-spec sandbox at
 * `<CACHE_DIR>/<sanitized-spec>/node_modules/<pkg>/`, while
 * `syncCachePackageJsonToIntent()` and the legacy install logic operate on the
 * flat path `<CACHE_DIR>/node_modules/<pkg>/`. When the two paths drift the
 * sandbox keeps loading the old version and the updater toasts an upgrade on
 * every restart (issue #4318).
 *
 * Walking up from `import.meta.url` returns the package.json that is actually
 * loaded; from there the sandbox workspace is the directory two levels above
 * (skipping `<pkg>/` and `node_modules/`). Returns null when the loaded module
 * lives outside the OpenCode cache (e.g. local dev, bunx run from elsewhere).
 */
export function getLoadedSandboxWorkspace(
  options: SandboxWorkspaceOptions = {},
): string | null {
  const findPackageJson = options.findPackageJson ?? findPackageJsonUp
  const cacheDir = options.cacheDir ?? CACHE_DIR
  const exists = options.existsSync ?? fs.existsSync

  let currentDir: string | null
  try {
    currentDir = options.currentDir === undefined
      ? path.dirname(fileURLToPath(import.meta.url))
      : options.currentDir
  } catch (err) {
    log("[auto-update-checker] Failed to resolve module dir for sandbox lookup:", err)
    return null
  }

  if (!currentDir) return null

  const pkgPath = findPackageJson(currentDir)
  if (!pkgPath) return null

  // <workspace>/node_modules/<pkg>/package.json
  const pkgDir = path.dirname(pkgPath)
  const nodeModulesDir = path.dirname(pkgDir)
  if (path.basename(nodeModulesDir) !== "node_modules") return null

  const workspace = path.dirname(nodeModulesDir)

  // Only trust the workspace if it lives under the OpenCode cache root.
  // This avoids targeting local-dev checkouts or bunx scratch dirs.
  const normalizedCache = path.resolve(cacheDir)
  const normalizedWorkspace = path.resolve(workspace)
  const cacheWithSep = normalizedCache.endsWith(path.sep)
    ? normalizedCache
    : normalizedCache + path.sep
  if (normalizedWorkspace !== normalizedCache && !normalizedWorkspace.startsWith(cacheWithSep)) {
    return null
  }

  if (!exists(workspace)) return null

  return workspace
}
