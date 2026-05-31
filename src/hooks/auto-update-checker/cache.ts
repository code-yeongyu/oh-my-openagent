import * as fs from "node:fs"
import * as path from "node:path"
import { ACCEPTED_PACKAGE_NAMES, CACHE_DIR, PACKAGE_NAME, getUserConfigDir } from "./constants"
import { log } from "../../shared/logger"

interface BunLockfile {
  workspaces?: {
    ""?: {
      dependencies?: Record<string, string>
    }
  }
  packages?: Record<string, unknown>
}

interface InvalidatePackageOptions {
  acceptedPackageNames?: readonly string[]
  cacheDir?: string
  defaultPackageName?: string
  userConfigDir?: string
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1")
}

function removeFromTextBunLock(lockPath: string, packageNames: readonly string[]): boolean {
  try {
    const content = fs.readFileSync(lockPath, "utf-8")
    const lock = JSON.parse(stripTrailingCommas(content)) as BunLockfile
    let removed = false

    for (const packageName of packageNames) {
      if (lock.packages?.[packageName]) {
        delete lock.packages[packageName]
        log(`[auto-update-checker] Removed from bun.lock: ${packageName}`)
        removed = true
      }
    }

    if (removed) {
      fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2))
    }

    return removed
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

function removeFromBunLock(cacheDir: string, packageNames: readonly string[]): boolean {
  const textLockPath = path.join(cacheDir, "bun.lock")
  const binaryLockPath = path.join(cacheDir, "bun.lockb")

  if (fs.existsSync(textLockPath)) {
    return removeFromTextBunLock(textLockPath, packageNames)
  }

  // Binary lockfiles cannot be parsed; deletion forces bun to re-resolve
  if (fs.existsSync(binaryLockPath)) {
    return deleteBinaryBunLock(binaryLockPath)
  }

  return false
}

function getInvalidationPackageNames(
  packageName: string,
  defaultPackageName: string,
  acceptedPackageNames: readonly string[]
): readonly string[] {
  if (packageName === defaultPackageName) {
    return acceptedPackageNames
  }

  return [packageName]
}

function removeSpecifierRootDirs(cacheDir: string, packageNames: readonly string[]): boolean {
  const parentDirs = [cacheDir, path.join(cacheDir, "packages")]
  const prefixes = packageNames.map(packageName => `${packageName}@`)
  let removed = false

  for (const parentDir of parentDirs) {
    if (!fs.existsSync(parentDir)) {
      continue
    }

    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !prefixes.some(prefix => entry.name.startsWith(prefix))) {
        continue
      }

      const specifierDir = path.join(parentDir, entry.name)
      fs.rmSync(specifierDir, { recursive: true, force: true })
      log(`[auto-update-checker] Specifier cache removed: ${specifierDir}`)
      removed = true
    }
  }

  return removed
}

export function invalidatePackage(
  packageName: string = PACKAGE_NAME,
  options: InvalidatePackageOptions = {}
): boolean {
  try {
    const acceptedPackageNames = options.acceptedPackageNames ?? ACCEPTED_PACKAGE_NAMES
    const cacheDir = options.cacheDir ?? CACHE_DIR
    const defaultPackageName = options.defaultPackageName ?? PACKAGE_NAME
    const userConfigDir = options.userConfigDir ?? getUserConfigDir()
    const packageNames = getInvalidationPackageNames(packageName, defaultPackageName, acceptedPackageNames)
    const pkgDirs = packageNames.flatMap(name => [
      path.join(userConfigDir, "node_modules", name),
      path.join(cacheDir, "node_modules", name),
    ])

    let packageRemoved = false
    let lockRemoved = false
    let specifierRemoved = false

    for (const pkgDir of pkgDirs) {
      if (fs.existsSync(pkgDir)) {
        fs.rmSync(pkgDir, { recursive: true, force: true })
        log(`[auto-update-checker] Package removed: ${pkgDir}`)
        packageRemoved = true
      }
    }

    specifierRemoved = removeSpecifierRootDirs(cacheDir, packageNames)
    lockRemoved = removeFromBunLock(cacheDir, packageNames)

    if (!packageRemoved && !specifierRemoved && !lockRemoved) {
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
