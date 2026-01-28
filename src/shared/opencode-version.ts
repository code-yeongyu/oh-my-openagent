import { execSync } from "child_process"

/**
 * Minimum OpenCode version required for this plugin.
 * This plugin only supports OpenCode 1.1.1+ which uses the permission system.
 */
export const MINIMUM_OPENCODE_VERSION = "1.1.1"

/**
 * OpenCode version that introduced native AGENTS.md injection.
 * PR #10678 merged on Jan 26, 2026 - OpenCode now dynamically resolves
 * AGENTS.md files from subdirectories as the agent explores them.
 * When this version is detected, the directory-agents-injector hook
 * is auto-disabled to prevent duplicate AGENTS.md loading.
 */
export const OPENCODE_NATIVE_AGENTS_INJECTION_VERSION = "1.1.37"

const NOT_CACHED = Symbol("NOT_CACHED")
let cachedVersion: string | null | typeof NOT_CACHED = NOT_CACHED

export function parseVersion(version: string): number[] {
  const cleaned = version.replace(/^v/, "").split("-")[0]
  return cleaned.split(".").map((n) => parseInt(n, 10) || 0)
}

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

export function isVersionGte(a: string, b: string): boolean {
  return compareVersions(a, b) >= 0
}

export function isVersionLt(a: string, b: string): boolean {
  return compareVersions(a, b) < 0
}

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
    cachedVersion = null
    return null
  }
}

export function isOpenCodeVersionAtLeast(version: string): boolean {
  const current = getOpenCodeVersion()
  if (!current) return true
  return isVersionGte(current, version)
}

export function resetVersionCache(): void {
  cachedVersion = NOT_CACHED
}

export function setVersionCache(version: string | null): void {
  cachedVersion = version
}
