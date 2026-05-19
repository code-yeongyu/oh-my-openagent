import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../../../shared/logger"
import type { PackageJson } from "../types"
import { INSTALLED_PACKAGE_JSON_CANDIDATES } from "../constants"
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
