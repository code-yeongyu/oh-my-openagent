import * as fs from "node:fs"
import * as path from "node:path"
import { CACHE_DIR, PACKAGE_NAME } from "./constants"
import { log } from "../../shared/logger"

export function invalidatePackage(packageName: string = PACKAGE_NAME): boolean {
  try {
    const pkgDir = path.join(CACHE_DIR, "node_modules", packageName)
    const pkgJsonPath = path.join(CACHE_DIR, "package.json")

    let packageRemoved = false
    let dependencyRemoved = false

    if (fs.existsSync(pkgDir)) {
      fs.rmSync(pkgDir, { recursive: true, force: true })
      log(`[auto-update-checker] Package removed: ${pkgDir}`)
      packageRemoved = true
    }

    if (fs.existsSync(pkgJsonPath)) {
      const content = fs.readFileSync(pkgJsonPath, "utf-8")
      const pkgJson = JSON.parse(content)
      if (pkgJson.dependencies?.[packageName]) {
        delete pkgJson.dependencies[packageName]
        fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))
        log(`[auto-update-checker] Dependency removed from package.json: ${packageName}`)
        dependencyRemoved = true
      }
    }

    if (!packageRemoved && !dependencyRemoved) {
      log(`[auto-update-checker] Package not found, nothing to invalidate: ${packageName}`)
      return false
    }

    return true
  } catch (err) {
    log("[auto-update-checker] Failed to invalidate package:", err)
    return false
  }
}

/** @deprecated Use invalidatePackage instead - this nukes ALL plugins */
export function invalidateCache(): boolean {
  log("[auto-update-checker] WARNING: invalidateCache is deprecated, use invalidatePackage")
  return invalidatePackage()
}
