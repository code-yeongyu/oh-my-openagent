import { readFileSync, readdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import { getPlatformPackageCandidates, getBinaryPath, resolvePlatformPackageBaseName } from "./platform.js"
import { detectPlatformBinaryMismatch } from "./version-mismatch.js"
import { getLibcFamily } from "./shared-helpers.js"

const require = createRequire(import.meta.url)

const MIN_OPENCODE_VERSION = "1.4.0"
const OPENCODE_PLUGIN_PACKAGES = ["oh-my-opencode", "oh-my-openagent"]

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
}

function compareVersions(current: string, minimum: string): boolean {
  const currentParts = parseVersion(current)
  const minimumParts = parseVersion(minimum)
  const length = Math.max(currentParts.length, minimumParts.length)

  for (let index = 0; index < length; index++) {
    const currentPart = currentParts[index] ?? 0
    const minimumPart = minimumParts[index] ?? 0
    if (currentPart > minimumPart) return true
    if (currentPart < minimumPart) return false
  }

  return true
}

function checkOpenCodeVersion(): { ok: boolean; version: string | null } {
  try {
    const result = require("node:child_process").execSync("opencode --version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    })
    const version = result.trim()
    const ok = compareVersions(version, MIN_OPENCODE_VERSION)
    return { ok, version }
  } catch {
    return { ok: true, version: null }
  }
}

function readMainPackageJson(): { name?: string; version?: string } | null {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  } catch {
    return null
  }
}

function getPackageBaseName(): string {
  const packageJson = readMainPackageJson()
  return resolvePlatformPackageBaseName(packageJson?.name || "oh-my-opencode")
}

function getMainPackageVersion(): string | null {
  const packageJson = readMainPackageJson()
  return packageJson?.version ?? null
}

function invalidateOpenCodePluginCache(): void {
  const cacheDir = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode")
  const parentDirs = [cacheDir, join(cacheDir, "packages")]
  const prefixes = OPENCODE_PLUGIN_PACKAGES.map((packageName) => `${packageName}@`)

  for (const parentDir of parentDirs) {
    try {
      for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
        if (entry.isDirectory() && prefixes.some((prefix) => entry.name.startsWith(prefix))) {
          rmSync(join(parentDir, entry.name), { recursive: true, force: true })
        }
      }
    } catch {
      // Cache invalidation is best-effort; postinstall should not fail package installs.
    }
  }
}

function readPlatformPackageVersion(pkg: string): string | null {
  try {
    const platformPackageJsonPath = require.resolve(`${pkg}/package.json`)
    const packageJson = JSON.parse(readFileSync(platformPackageJsonPath, "utf8"))
    return packageJson.version ?? null
  } catch {
    return null
  }
}

function main(): void {
  const { platform, arch } = process
  const libcFamily = getLibcFamily()
  const packageBaseName = getPackageBaseName()

  invalidateOpenCodePluginCache()

  const versionCheck = checkOpenCodeVersion()
  if (versionCheck.version && !versionCheck.ok) {
    console.warn(`\u26a0 oh-my-opencode requires OpenCode >= ${MIN_OPENCODE_VERSION}`)
    console.warn(`  Detected: ${versionCheck.version}`)
    console.warn(`  Please update OpenCode to avoid compatibility issues.`)
  }

  try {
    const packageCandidates = getPlatformPackageCandidates({
      platform,
      arch,
      libcFamily,
      packageBaseName,
    })

    const resolvedPackage = packageCandidates.find((pkg) => {
      try {
        require.resolve(getBinaryPath(pkg, platform))
        return true
      } catch {
        return false
      }
    })

    if (!resolvedPackage) {
      throw new Error(
        `No platform binary package installed. Tried: ${packageCandidates.join(", ")}`
      )
    }

    const mismatch = detectPlatformBinaryMismatch({
      mainVersion: getMainPackageVersion(),
      platformVersion: readPlatformPackageVersion(resolvedPackage),
      platformPackage: resolvedPackage,
    })
    if (mismatch) {
      console.warn(`\u26a0 oh-my-opencode platform binary version mismatch detected`)
      console.warn(`  ${packageBaseName}: ${mismatch.mainVersion}`)
      console.warn(`  ${mismatch.platformPackage}: ${mismatch.platformVersion}`)
      console.warn(`  The startup banner may show the stale version until the platform binary is updated.`)
      console.warn(`  Fix: npm install -g ${packageBaseName}@${mismatch.mainVersion} ${mismatch.platformPackage}@${mismatch.mainVersion}`)
    }

    console.log(`\u2713 oh-my-opencode binary installed for ${platform}-${arch} (${resolvedPackage})`)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`\u26a0 oh-my-opencode: ${message}`)
    console.warn(`  The CLI may not work on this platform.`)
  }
}

main()
