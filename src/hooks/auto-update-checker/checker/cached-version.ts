import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../../../shared/logger"
import type { PackageJson } from "../types"
import { INSTALLED_PACKAGE_JSON_CANDIDATES, ACCEPTED_PACKAGE_NAMES } from "../constants"
import { findPackageJsonUp } from "./package-json-locator"

interface CachedVersionOptions {
  packageJsonCandidates?: readonly string[]
  findPackageJson?: (startPath: string) => string | null
  currentDir?: string | null
  execDir?: string | null
}

function readPackageVersion(packageJsonPath: string): string | null {
  const content = fs.readFileSync(packageJsonPath, "utf-8")
  const pkg = JSON.parse(content) as PackageJson
  return pkg.version ?? null
}

/**
 * Walk up from startPath looking for `node_modules/<accepted-name>/package.json`.
 * Handles the case where the compiled bundle lives in a sandboxed hash directory
 * (e.g., `<CACHE>/packages/<hash>/dist/index.js`) without a `package.json` in the
 * ancestor chain, but the actual package is at
 * `<CACHE>/packages/<hash>/node_modules/oh-my-opencode/package.json`.
 */
function findNodeModulesPackageJson(startPath: string): string | null {
  const acceptedNameSet = new Set<string>(ACCEPTED_PACKAGE_NAMES)
  try {
    const stat = fs.statSync(startPath)
    let dir = stat.isDirectory() ? startPath : path.dirname(startPath)

    for (let i = 0; i < 10; i++) {
      const nmDir = path.join(dir, "node_modules")
      if (fs.existsSync(nmDir) && fs.statSync(nmDir).isDirectory()) {
        for (const pkgName of fs.readdirSync(nmDir)) {
          if (acceptedNameSet.has(pkgName)) {
            const pkgPath = path.join(nmDir, pkgName, "package.json")
            if (fs.existsSync(pkgPath)) {
              return pkgPath
            }
          }
        }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    // ignore
  }
  return null
}

export function getCachedVersion(options: CachedVersionOptions = {}): string | null {
  const packageJsonCandidates = options.packageJsonCandidates ?? INSTALLED_PACKAGE_JSON_CANDIDATES
  const findPackageJson = options.findPackageJson ?? findPackageJsonUp

  // Walk up from the loaded module first. OpenCode loads plugins from a
  // per-plugin sandbox at <CACHE_DIR>/<plugin-entry>/node_modules/<pkg>/, while
  // a parallel flat install at <CACHE_DIR>/node_modules/<pkg>/ can drift
  // independently when bun re-resolves "latest". Reading the flat install
  // first means the toast can announce a version the runtime isn't running.
  // The module-relative walk-up always reflects what is actually loaded.
  try {
    const currentDir = options.currentDir === undefined ? path.dirname(fileURLToPath(import.meta.url)) : options.currentDir
    if (currentDir) {
      const pkgPath = findPackageJson(currentDir)
      if (pkgPath) {
        return readPackageVersion(pkgPath)
      }
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from current directory:", err)
  }

  // If module-relative walk-up fails, check node_modules/<pkg>/package.json in
  // ancestor directories. The compiled bundle may be in a sandboxed hash directory
  // (<CACHE>/packages/<hash>/dist/index.js) while the package lives at
  // <CACHE>/packages/<hash>/node_modules/oh-my-opencode/package.json.
  try {
    const currentDir = options.currentDir === undefined ? path.dirname(fileURLToPath(import.meta.url)) : options.currentDir
    if (currentDir) {
      const pkgPath = findNodeModulesPackageJson(currentDir)
      if (pkgPath) {
        return readPackageVersion(pkgPath)
      }
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from node_modules walk-up:", err)
  }

  for (const candidate of packageJsonCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        return readPackageVersion(candidate)
      }
    } catch {
      // ignore; try next candidate
    }
  }

  try {
    const execDir = options.execDir === undefined ? path.dirname(fs.realpathSync(process.execPath)) : options.execDir
    if (execDir) {
      const pkgPath = findPackageJson(execDir)
      if (pkgPath) {
        return readPackageVersion(pkgPath)
      }
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from execPath:", err)
  }

  return null
}
