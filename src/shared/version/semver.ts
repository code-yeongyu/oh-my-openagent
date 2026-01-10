/**
 * Zero-dependency semver parsing and comparison
 */

import type { ParsedVersion, VersionDiff } from "./types"

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/

/**
 * Parse a semver version string into its components
 */
export function parse(version: string): ParsedVersion | null {
  const match = version.trim().match(SEMVER_REGEX)
  if (!match) return null

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] ? match[4].split(".") : [],
    build: match[5] ? match[5].split(".") : [],
    raw: version,
  }
}

/**
 * Compare two semver versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a)
  const pb = parse(b)

  // Fallback to string comparison if parsing fails
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0

  // Compare major.minor.patch
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] > pb[key]) return 1
    if (pa[key] < pb[key]) return -1
  }

  // Prerelease versions have lower precedence than release versions
  // 1.0.0-alpha < 1.0.0
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1

  // Both have prereleases, compare them
  const maxLen = Math.max(pa.prerelease.length, pb.prerelease.length)
  for (let i = 0; i < maxLen; i++) {
    const ai = pa.prerelease[i]
    const bi = pb.prerelease[i]

    // Shorter prerelease has lower precedence
    // 1.0.0-alpha < 1.0.0-alpha.1
    if (ai === undefined) return -1
    if (bi === undefined) return 1

    // Numeric identifiers compared as integers
    const aNum = parseInt(ai, 10)
    const bNum = parseInt(bi, 10)

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum > bNum) return 1
      if (aNum < bNum) return -1
    } else if (!isNaN(aNum)) {
      // Numeric < alphanumeric
      return -1
    } else if (!isNaN(bNum)) {
      return 1
    } else {
      // Both alphanumeric, compare as strings
      if (ai > bi) return 1
      if (ai < bi) return -1
    }
  }

  return 0
}

/**
 * Check if version a is greater than version b
 */
export function gt(a: string, b: string): boolean {
  return compare(a, b) === 1
}

/**
 * Check if version a is less than version b
 */
export function lt(a: string, b: string): boolean {
  return compare(a, b) === -1
}

/**
 * Check if version a equals version b
 */
export function eq(a: string, b: string): boolean {
  return compare(a, b) === 0
}

/**
 * Check if version a is greater than or equal to version b
 */
export function gte(a: string, b: string): boolean {
  return compare(a, b) >= 0
}

/**
 * Check if version a is less than or equal to version b
 */
export function lte(a: string, b: string): boolean {
  return compare(a, b) <= 0
}

/**
 * Check if a version string contains prerelease identifiers
 */
export function isPrerelease(version: string): boolean {
  const parsed = parse(version)
  return parsed ? parsed.prerelease.length > 0 : false
}

/**
 * Get the difference type between two versions
 */
export function diff(a: string, b: string): VersionDiff | null {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  if (eq(a, b)) return "none"

  if (pa.major !== pb.major) return "major"
  if (pa.minor !== pb.minor) return "minor"
  if (pa.patch !== pb.patch) return "patch"
  return "prerelease"
}

/**
 * Coerce a loose version string into a valid semver
 * e.g., "3" -> "3.0.0", "3.1" -> "3.1.0"
 */
export function coerce(version: string): string | null {
  // Already valid?
  if (parse(version)) return version

  // Try to extract numbers
  const match = version.match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!match) return null

  const major = match[1] ?? "0"
  const minor = match[2] ?? "0"
  const patch = match[3] ?? "0"

  return `${major}.${minor}.${patch}`
}

/**
 * Get the maximum version from an array
 */
export function maxVersion(versions: string[]): string | null {
  if (versions.length === 0) return null

  return versions.reduce((max, v) => (gt(v, max) ? v : max), versions[0])
}

/**
 * Get the minimum version from an array
 */
export function minVersion(versions: string[]): string | null {
  if (versions.length === 0) return null

  return versions.reduce((min, v) => (lt(v, min) ? v : min), versions[0])
}

/**
 * Sort versions in ascending order
 */
export function sort(versions: string[]): string[] {
  return [...versions].sort(compare)
}

/**
 * Sort versions in descending order
 */
export function rsort(versions: string[]): string[] {
  return [...versions].sort((a, b) => compare(b, a))
}
