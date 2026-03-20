import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../../../shared/logger"
import type { PackageJson } from "../types"
import { INSTALLED_PACKAGE_JSON } from "../constants"
import { findPackageJsonUp } from "./package-json-locator"

export function getCachedVersion(): string | null {
  try {
    if (fs.existsSync(INSTALLED_PACKAGE_JSON)) {
      const content = fs.readFileSync(INSTALLED_PACKAGE_JSON, "utf-8")
      const pkg = JSON.parse(content) as PackageJson
      if (pkg.version) return pkg.version
    }
  } catch {
    // ignore
  }

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = findPackageJsonUp(currentDir)
    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content) as PackageJson
      if (pkg.version) return pkg.version
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from current directory:", err)
  }

  try {
    const execDir = path.dirname(fs.realpathSync(process.execPath))
    const pkgPath = findPackageJsonUp(execDir)
    if (pkgPath) {
      const content = fs.readFileSync(pkgPath, "utf-8")
      const pkg = JSON.parse(content) as PackageJson
      if (pkg.version) return pkg.version
    }
  } catch (err) {
    log("[auto-update-checker] Failed to resolve version from execPath:", err)
  }

  return null
}
