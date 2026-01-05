import { execSync } from "child_process"

/**
 * OpenCode version where the permission system changed from `tools` to `permission`.
 * Versions >= this use the new `permission: { tool: "allow" | "deny" | "ask" }` format.
 * Versions < this use the legacy `tools: { tool: boolean }` format.
 */
export const PERMISSION_BREAKING_VERSION = "1.1.1"

const NOT_CACHED = Symbol("NOT_CACHED")
let cachedVersion: string | null | typeof NOT_CACHED = NOT_CACHED

/**
 * Parse a version string into numeric parts.
 * Handles versions like "1.1.1", "v1.1.1", "1.1.1-beta.1"
 */
export function parseVersion(version: string): number[] {
  const cleaned = version.replace(/^v/, "").split("-")[0]
  return cleaned.split(".").map((n) => parseInt(n, 10) || 0)
}

/**
 * Compare two version strings.
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = parseVersion(a)
  const partsB = parseVersion(b)
  const maxLen = Math.max(partsA.length, partsB.length)

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] ?? 0
    const numB = partsB[i] ?? 0
    if (numA < numB) return -1
    if (numA > numB) return 1
  }
  return 0
}

/**
 * Check if version a is greater than or equal to version b.
 */
export function isVersionGte(a: string, b: string): boolean {
  return compareVersions(a, b) >= 0
}

/**
 * Check if version a is less than version b.
 */
export function isVersionLt(a: string, b: string): boolean {
  return compareVersions(a, b) < 0
}

/**
 * Get the installed OpenCode version by running `opencode --version`.
 * Result is cached for performance.
 * @returns Version string (e.g., "1.1.1") or null if unable to detect
 */
export function getOpenCodeVersion(): string | null {
  if (cachedVersion !== NOT_CACHED) {
    return cachedVersion
  }

  try {
    const result = execSync("opencode --version", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const versionMatch = result.match(/(\d+\.\d+\.\d+(?:-[\w.]+)?)/)
    cachedVersion = versionMatch?.[1] ?? null
    return cachedVersion
  } catch {
    // If opencode command fails, assume new version (safer default)
    cachedVersion = null
    return null
  }
}

/**
 * Check if the installed OpenCode version supports the new permission system.
 * If version cannot be detected, assumes new system (safer default).
 */
export function supportsNewPermissionSystem(): boolean {
  const version = getOpenCodeVersion()
  if (!version) return true // Assume new if can't detect
  return isVersionGte(version, PERMISSION_BREAKING_VERSION)
}

/**
 * Check if the installed OpenCode version uses the legacy tools system.
 */
export function usesLegacyToolsSystem(): boolean {
  return !supportsNewPermissionSystem()
}

/**
 * Reset the version cache. Useful for testing.
 */
export function resetVersionCache(): void {
  cachedVersion = NOT_CACHED
}

/**
 * Set the version cache manually. Useful for testing.
 */
export function setVersionCache(version: string | null): void {
  cachedVersion = version
}
