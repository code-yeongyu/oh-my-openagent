import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../../../shared/logger"
import type { PackageJson } from "../types"
import { INSTALLED_PACKAGE_JSON_CANDIDATES } from "../constants"
import { findPackageJsonUp } from "./package-json-locator"

function readPackageVersion(packageJsonPath: string): string | null {
  const content = fs.readFileSync(packageJsonPath, "utf-8")
  const pkg = JSON.parse(content) as PackageJson
  return pkg.version ?? null
}

export function getCachedVersion(): string | null {
  // Walk up from the loaded module first. OpenCode loads plugins from a
  // per-plugin sandbox at <CACHE_DIR>/<plugin-entry>/node_modules/<pkg>/, while
  // a parallel flat install at <CACHE_DIR>/node_modules/<pkg>/ can drift
  // independently when bun re-resolves "latest". Reading the flat install
  // first means the toast can announce a version the runtime isn't running.
  // The module-relative walk-up always reflects what is actually loaded.
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = findPackageJsonUp(currentDir)
    if (pkgPath) {
      return readPackageVersion(pkgPath)
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from current directory:", err)
  }

  for (const candidate of INSTALLED_PACKAGE_JSON_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        return readPackageVersion(candidate)
      }
    } catch {
      // ignore; try next candidate
    }
  }

  try {
    const execDir = path.dirname(fs.realpathSync(process.execPath))
    const pkgPath = findPackageJsonUp(execDir)
    if (pkgPath) {
      return readPackageVersion(pkgPath)
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from execPath:", err)
  }

  return null
}
