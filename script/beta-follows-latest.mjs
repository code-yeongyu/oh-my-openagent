import { pathToFileURL } from "node:url"

// beta is the newer of the latest stable release and the newest prerelease (#12987). A stable publish therefore also
// moves omo-ai@beta and get.omo.dev/channels/beta, unless beta already holds a newer prerelease.

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

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

/**
 * The beta decision from the raw `npm view --json omo-ai dist-tags` output. Returns null when that output is not a
 * successful lookup (empty, not JSON, an npm error object, or no `latest` tag), so a failed lookup is never read as
 * "beta is absent" and can never move beta down over a newer prerelease. An object without `beta` means beta is absent.
 */
export function betaMustFollowLatestFromDistTags(stableVersion, distTagsJson) {
  let distTags
  try {
    distTags = JSON.parse(distTagsJson ?? "")
  } catch {
    distTags = null
  }
  const lookupSucceeded =
    distTags !== null && typeof distTags === "object" && !Array.isArray(distTags) && typeof distTags.latest === "string"
  const beta = lookupSucceeded && typeof distTags.beta === "string" ? distTags.beta : ""
  // Validate the stable version first, so a bad caller argument fails loudly even when the lookup also failed.
  const move = betaMustFollowLatest(stableVersion, beta)
  return lookupSucceeded ? move : null
}

function parseDistTags(distTagsJson) {
  try {
    const distTags = JSON.parse(distTagsJson ?? "")
    const usable =
      distTags !== null &&
      typeof distTags === "object" &&
      !Array.isArray(distTags) &&
      typeof distTags.latest === "string"
    return usable ? distTags : null
  } catch {
    return null
  }
}

/**
 * The newest version across the given raw dist-tags objects (null entries are skipped): the latest tag and every
 * prerelease-tagged version, or null when none is usable.
 */
function newestFloor(tagObjects) {
  let floor = null
  for (const tags of tagObjects) {
    for (const [tag, value] of tags ? Object.entries(tags) : []) {
      const parsed = typeof value === "string" ? parseVersion(value) : null
      if (!parsed || (tag !== "latest" && parsed.pre.length === 0)) continue
      if (floor === null || compareVersions(value, floor) > 0) floor = value
    }
  }
  return floor
}

function validBeta(tags) {
  return typeof tags.beta === "string" && parseVersion(tags.beta) ? tags.beta : ""
}

/**
 * The dist-tag guard decision from one raw dist-tags JSON read: null when it is not a usable lookup, "ok" when beta is
 * at least the floor (the newer of latest and every prerelease on any dist-tag), "behind" with that floor otherwise.
 */
export function guardBetaFromDistTags(distTagsJson) {
  const tags = parseDistTags(distTagsJson)
  if (!tags) return null
  const floor = newestFloor([tags])
  const beta = validBeta(tags)
  if (beta && (floor === null || compareVersions(beta, floor) >= 0)) return { status: "ok", beta }
  return { status: "behind", beta, floor }
}

/**
 * Re-checks beta after our own "npm dist-tag add omo-ai@<written> beta" (#13149), from the raw dist-tags JSON of the
 * read before the write and the read after it. status is "lookup-failed" when the second read is unusable, "behind"
 * when beta is older than the floor (the newest of latest and every prerelease tag seen in either read), even when it
 * is newer than what we wrote, with the floor and the exact command that repairs it; "ahead" when beta is newer than
 * what we wrote and at or above the floor (someone moved it forward: leave it); "ok" otherwise.
 */
export function verifyBetaAfterMove(writtenVersion, beforeDistTagsJson, afterDistTagsJson) {
  const after = parseDistTags(afterDistTagsJson)
  if (!after) return { status: "lookup-failed" }
  const floor = newestFloor([parseDistTags(beforeDistTagsJson), after])
  const beta = validBeta(after)
  const belowFloor = beta !== "" && floor !== null && compareVersions(beta, floor) < 0
  if (beta && !belowFloor && compareVersions(beta, writtenVersion) > 0) return { status: "ahead", beta }
  if (beta && !belowFloor) return { status: "ok", beta }
  const target = floor ?? writtenVersion
  return { status: "behind", beta, floor: target, command: "npm dist-tag add omo-ai@" + target + " beta" }
}

function cliDecision(args) {
  if (args[0] === "--verify") {
    const result = verifyBetaAfterMove(args[1] ?? "", args[2] ?? "", args[3] ?? "")
    if (result.status === "lookup-failed") return "lookup=failed"
    return "beta=" + result.status + ":" + (result.status === "behind" ? result.floor : result.beta)
  }

  if (args[0] === "--guard") {
    const result = guardBetaFromDistTags(args[1] ?? "")
    if (result === null) return "lookup=failed"
    return result.status === "ok" ? "beta=ok:" + result.beta : "beta=behind:" + result.floor + ":" + result.beta
  }

  if (args[0] === "--dist-tags") {
    const move = betaMustFollowLatestFromDistTags(args[1] ?? "", args[2] ?? "")
    return move === null ? "lookup=failed" : `move=${move}`
  }
  return `move=${betaMustFollowLatest(args[0] ?? "", args[1] ?? "")}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(cliDecision(process.argv.slice(2)))
  } catch (error) {
    console.error(`::error::${error.message}`)
    process.exitCode = 1
  }
}
