import { pathToFileURL } from "node:url"

// beta is the newer of the latest stable release and the newest prerelease (#12987). A stable publish therefore also
// moves omo-ai@beta and get.omo.dev/channels/beta, unless beta already holds a newer prerelease.

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version)
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4]?.split(".") ?? [] }
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right))
  // SemVer 2.0 section 11: numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** SemVer 2.0 precedence: -1, 0 or 1. Build metadata is ignored. Throws on an invalid version. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a) throw new Error(`Invalid version: ${left}`)
  if (!b) throw new Error(`Invalid version: ${right}`)
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index])
  }
  // A prerelease X.Y.Z-<pre> sorts before the stable X.Y.Z.
  if (a.pre.length === 0 || b.pre.length === 0) return Math.sign(b.pre.length - a.pre.length)
  for (let index = 0; index < Math.min(a.pre.length, b.pre.length); index++) {
    const diff = compareIdentifiers(a.pre[index], b.pre[index])
    if (diff !== 0) return diff
  }
  return Math.sign(a.pre.length - b.pre.length)
}

/**
 * Whether beta must move to the stable version just published: true when beta is missing, invalid, or older than
 * it; false when beta already equals it or holds a newer version (a prerelease of a higher X.Y.Z).
 */
export function betaMustFollowLatest(stableVersion, currentBeta) {
  const stable = parseVersion(stableVersion)
  if (!stable || stable.pre.length > 0) throw new Error(`Not a stable version: ${stableVersion}`)
  const beta = (currentBeta ?? "").trim()
  if (!parseVersion(beta)) return true
  return compareVersions(beta, stableVersion) < 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`move=${betaMustFollowLatest(process.argv[2] ?? "", process.argv[3] ?? "")}`)
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
