/**
 * Prerelease-aware semver comparison for update decisions.
 *
 * `compareVersions` in `shared/opencode-version` strips prerelease suffixes
 * (it exists to gate OpenCode host features), so it cannot order
 * `5.0.0-beta.85` against `5.0.0-beta.89`. Update checks must: beta channel
 * users live entirely on prereleases, and treating "different" as "update"
 * offers a downgrade whenever a local build is newer than the registry tag.
 */

interface ParsedSemver {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER_REGEX.exec(version.trim())
  if (!match) return null
  const [, major, minor, patch, prerelease] = match
  return {
    core: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ? prerelease.split(".") : [],
  }
}

function comparePrerelease(a: readonly string[], b: readonly string[]): -1 | 0 | 1 {
  // A release outranks any of its prereleases: 5.0.0-beta.89 < 5.0.0.
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const idA = a[i] ?? ""
    const idB = b[i] ?? ""
    if (idA === idB) continue
    const numA = /^\d+$/.test(idA)
    const numB = /^\d+$/.test(idB)
    if (numA && numB) return Number(idA) < Number(idB) ? -1 : 1
    // Numeric identifiers sort before alphanumeric ones.
    if (numA) return -1
    if (numB) return 1
    return idA < idB ? -1 : 1
  }
  if (a.length === b.length) return 0
  return a.length < b.length ? -1 : 1
}

/**
 * Returns -1 when `a` is older than `b`, 0 when equal, 1 when newer.
 * Returns null when either side is not parseable semver — callers must treat
 * null as "cannot tell" and never as "update available".
 */
export function compareSemverVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parsedA = parseSemver(a)
  const parsedB = parseSemver(b)
  if (!parsedA || !parsedB) return null

  for (let i = 0; i < 3; i++) {
    const partA = parsedA.core[i] ?? 0
    const partB = parsedB.core[i] ?? 0
    if (partA !== partB) return partA < partB ? -1 : 1
  }
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease)
}

/** True only when `latestVersion` is strictly newer than `currentVersion`. */
export function isStrictlyNewerVersion(currentVersion: string, latestVersion: string): boolean {
  return compareSemverVersions(currentVersion, latestVersion) === -1
}
