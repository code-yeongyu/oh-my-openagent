import * as fs from "node:fs"
import * as path from "node:path"
import { CACHE_DIR, PACKAGE_NAME, getUserConfigDir } from "./constants"
import { log } from "../../shared/logger"

interface BunLockfile {
  workspaces?: {
    ""?: {
      dependencies?: Record<string, string>
    }
  }
  packages?: Record<string, unknown>
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1")
}

function removeFromTextBunLock(lockPath: string, packageName: string): boolean {
  try {
    const content = fs.readFileSync(lockPath, "utf-8")
    const lock = JSON.parse(stripTrailingCommas(content)) as BunLockfile

    if (lock.packages?.[packageName]) {
      delete lock.packages[packageName]
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
      log(`[auto-update-checker] Removed from bun.lock: ${packageName}`)
      return true
    }
    return false
  } catch {
    return false
  }
}

function deleteBinaryBunLock(lockPath: string): boolean {
  try {
    fs.unlinkSync(lockPath)
    log(`[auto-update-checker] Removed bun.lockb to force re-resolution`)
    return true
  } catch {
    return false
  }
}

function removeFromBunLock(packageName: string): boolean {
  const textLockPath = path.join(CACHE_DIR, "bun.lock")
  const binaryLockPath = path.join(CACHE_DIR, "bun.lockb")

  if (fs.existsSync(textLockPath)) {
    return removeFromTextBunLock(textLockPath, packageName)
  }

  // Binary lockfiles cannot be parsed; deletion forces bun to re-resolve
  if (fs.existsSync(binaryLockPath)) {
    return deleteBinaryBunLock(binaryLockPath)
  }

  return false
}

export function invalidatePackage(packageName: string = PACKAGE_NAME): boolean {
  try {
    const userConfigDir = getUserConfigDir()
    const pkgDirs = [
      path.join(userConfigDir, "node_modules", packageName),
      path.join(CACHE_DIR, "node_modules", packageName),
    ]

    let packageRemoved = false
    let lockRemoved = false

    for (const pkgDir of pkgDirs) {
      if (fs.existsSync(pkgDir)) {
        fs.rmSync(pkgDir, { recursive: true, force: true })
        log(`[auto-update-checker] Package removed: ${pkgDir}`)
        packageRemoved = true
      }
    }

    lockRemoved = removeFromBunLock(packageName)

    if (!packageRemoved && !lockRemoved) {
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
