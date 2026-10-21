import { readFileSync } from "node:fs"
import { join } from "node:path"

import { senpiPackageRoot } from "./package-paths.js"
/**
 * The engine-version gate for the reference-object setup path.
 *
 * omO setup can write `{file:...}` / `{env:...}` as reference objects
 * (`{$file: ...}`, `{$env: ...}`, `{$concat: [...]}`) that the engine resolves
 * at load time. An engine that does not understand those objects would pass
 * them through unvalidated, so the shape is only written for an engine version
 * that is known to support it.
 *
 * The comparison is semver, not string ordering, so the gate opens on purpose
 * and not by accident of how a date-shaped version happens to sort.
 */

/**
 * The minimum engine version that supports the reference-object shapes.
 *
 * PENDING: the senpi PR that adds the load-time resolver will name the
 * version. Until it is known this is `null`, which closes the gate by
 * construction — a version string could not be chosen that is guaranteed
 * unreachable, and a sentinel like "0.0.0" would be LOWER than every real
 * version and would open the gate for every engine, which is the accident
 * this gate exists to prevent.
 *
 * Set it to the exact version the senpi PR names, and the gate opens for
 * that engine and later. `OMO_REFERENCE_OBJECTS=1` forces the new shape
 * regardless of the engine version, for tests and for a user who knows their
 * engine supports it.
 */
export const REFERENCE_OBJECTS_MIN_SENPI_VERSION = null

const PRERELEASE_IDENTIFIER = /^\d+$/

/**
 * Compare two semver strings. Returns a negative number when `left` sorts
 * before `right`, zero when they are equal, a positive number when `left`
 * sorts after.
 *
 * Handles `major.minor.patch`, an optional `-prerelease`, and an optional
 * `+build` (ignored, per semver). The engine's version is date-shaped
 * (`2026.10.20-1`) and the omO-ai package is semver (`5.1.40`); both parse
 * as semver, so one comparison covers either.
 */
export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  const core = compareCore(a, b)
  if (core !== 0) return core
  return comparePrerelease(a.prerelease, b.prerelease)
}

function compareCore(a, b) {
  for (const part of ["major", "minor", "patch"]) {
    if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1
  }
  return 0
}

// A release outranks any prerelease of the same version.
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  const shared = Math.min(left.length, right.length)
  for (let i = 0; i < shared; i++) {
    const compared = comparePrereleaseIdentifier(left[i], right[i])
    if (compared !== 0) return compared
  }
  if (left.length === right.length) return 0
  return left.length < right.length ? -1 : 1
}

function comparePrereleaseIdentifier(left, right) {
  if (left === right) return 0
  const leftNumeric = PRERELEASE_IDENTIFIER.test(left)
  const rightNumeric = PRERELEASE_IDENTIFIER.test(right)
  if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (leftNumeric) return -1
  if (rightNumeric) return 1
  return left < right ? -1 : 1
}

function parseSemver(version) {
  const withoutBuild = String(version).split("+")[0]
  const [core, prerelease = ""] = withoutBuild.split("-")
  const [major, minor, patch] = core.split(".").map((part) => {
    const value = Number.parseInt(part, 10)
    return Number.isFinite(value) ? value : 0
  })
  return {
    major: major ?? 0,
    minor: minor ?? 0,
    patch: patch ?? 0,
    prerelease: prerelease === "" ? [] : prerelease.split("."),
  }
}

/**
 * Whether the installed engine reads reference objects.
 *
 * The comparison is semver, so the gate opens on purpose and not by accident of how a version
 * string happens to sort. The threshold is the exact version the maintainer's senpi PR names, and
 * it is `null` until then, which closes the gate by construction: a version that is lower than
 * every real version would open it for every engine.
 *
 * `OMO_REFERENCE_OBJECTS=1` forces the new shape regardless of the engine version, for tests and
 * early adopters.
 */
export function shouldEmitReferenceObjects(options = {}) {
  if (options.referenceObjects === true) return true
  if (options.referenceObjects === false) return false
  if (process.env.OMO_REFERENCE_OBJECTS === "1") return true
  if (options.env !== undefined && options.env.OMO_REFERENCE_OBJECTS === "1") return true
  return engineSupportsReferenceObjects(readSenpiVersion(options))
}

function readSenpiVersion(options = {}) {
  try {
    const root = options.senpiPackageRoot ?? senpiPackageRoot()
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
  } catch {
    return "unresolved"
  }
}

function engineSupportsReferenceObjects(version) {
  if (version === "unresolved") return false
  if (REFERENCE_OBJECTS_MIN_SENPI_VERSION === null) return false
  return compareSemver(version, REFERENCE_OBJECTS_MIN_SENPI_VERSION) >= 0
}
