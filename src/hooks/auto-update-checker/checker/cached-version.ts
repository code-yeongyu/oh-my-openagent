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
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = findPackageJsonUp(currentDir)
    if (pkgPath) {
      return readPackageVersion(pkgPath)
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from current directory:", err)
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
