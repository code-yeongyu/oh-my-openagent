import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Marker file name (a single dot-prefixed file inside the published plugin/).
export const PAYLOAD_SHA_MARKER_FILENAME = ".omo-payload.sha256"

// sha256sum format: `<hex>  plugin\n`. The host name ("plugin") lets a reviewer eyeball a printed
// artifact and the runtime and the build write the same line, so a diff between the marker in a
// published tarball and a freshly computed one is always byte-identical.
export function PAYLOAD_SHA_MARKER_FORMAT(hex) {
  return `${hex}  plugin\n`
}

function toHexSha(content) {
  return createHash("sha256").update(content).digest("hex")
}

/**
 * Walk `pluginRoot` recursively and return a deterministic sorted list of {path, sha} entries for
 * every regular file. Symlinks and other non-regular entries are skipped without throwing (a
 * hostile user can already follow the symlink they planted; the integrity check is for download
 * corruption and post-install tampering, not for symlink gates).
 */
function manifestCompare(a, b) {
  if (a.path < b.path) return -1
  if (a.path > b.path) return 1
  return 0
}

function collectFileManifest(pluginRoot) {
  const entries = []
  function walk(current, prefix) {
    let names
    try {
      names = readdirSync(current).sort()
    } catch {
      return
    }
    for (const name of names) {
      const fullPath = join(current, name)
      const relativePath = prefix === "" ? name : `${prefix}/${name}`
      let stat
      try {
        stat = lstatSync(fullPath)
      } catch {
        continue
      }
      // Recurse into directories; only leaf files land in the manifest.
      if (stat.isDirectory()) {
        walk(fullPath, relativePath)
        continue
      }
      if (!stat.isFile()) continue
      let content
      try {
        content = readFileSync(fullPath)
      } catch {
        continue
      }
      entries.push({ path: relativePath, sha: toHexSha(content) })
    }
  }
  walk(pluginRoot, "")
  entries.sort(manifestCompare)
  return entries
}

/**
 * The excluded basenames during the recompute. The marker itself is the only thing this PR-F
 * excludes; future integrity markers (if any) would be added here so they do not need a second
 * pass.
 */
function isMarkerFile(relativePath) {
  return relativePath === PAYLOAD_SHA_MARKER_FILENAME
}

/**
 * Compute the SHA256 of the staged plugin payload, EXCLUDING the marker file itself. The hash is
 * the SHA256 of the manifest string `<path>\0<sha>\n` per file, joined in lexicographic order.
 */
export function computePayloadSha256(args) {
  const manifest = collectFileManifest(args.pluginRoot)
    .filter((entry) => !isMarkerFile(entry.path))
    .map((entry) => `${entry.path}\0${entry.sha}\n`)
    .join("")
  return toHexSha(manifest)
}

/**
 * Build the user-facing refusal message. Kept as a separate function so the launcher and its
 * tests agree on wording without copy-paste, and so future flag changes (a different reinstall
 * hint, a different second sentence) live in one place.
 */
export function payloadIntegrityFailureFor(args) {
  const tail = `Please reinstall via \`${args.reinstallCommand}\`.`
  if (args.reason === "missing_marker") {
    return `Plugin payload integrity check failed: marker file ${PAYLOAD_SHA_MARKER_FILENAME} is missing. ${tail}\n`
  }
  if (args.reason === "empty_payload") {
    return `Plugin payload integrity check failed: ${args.expected}  plugin but the staged payload is empty. ${tail}\n`
  }
  // The remaining reason is `mismatch`: a payload whose recomputed hash disagrees with the marker.
  return `Plugin payload integrity check failed: expected ${args.expected}, got ${args.actual}. ${tail}\n`
}

/**
 * Verify the plugin payload sha256 against the marker. On mismatch, missing marker, or empty
 * payload, reports the user-facing refusal message and asks `processExit` to terminate with
 * code 1. The default `processExit` is `process.exit(1)`. The function returns the result so
 * tests can assert on it without taking down the runner; production callers wire `processExit`
 * to the real thing.
 */
export function verifyPayloadIntegrity(deps) {
  const report = deps.report ?? ((line) => process.stderr.write(line))
  const processExit = deps.processExit ?? ((code) => process.exit(code))
  const fileExists = deps.fileExists ?? ((path) => existsSync(path))
  const readMarker = deps.readMarker ?? ((path) => readFileSync(path, "utf8"))
  const hashPayload = deps.hashPayload ?? computePayloadSha256
  const directoryExists = deps.directoryExists ?? ((path) => existsSync(path))
  const markerPath = join(deps.pluginRoot, PAYLOAD_SHA_MARKER_FILENAME)

  // Source-tree dev mode: packageRoot/plugin/ may not exist when the launcher is invoked from a
  // freshly cloned checkout (the publish dir is gitignored). The published-only check would refuse a
  // developer's local run for the wrong reason - the marker is a published-build construct, not a
  // source-checkout invariant.
  if (!directoryExists(deps.pluginRoot)) {
    return { ok: true, expected: "", actual: "", skipped: "plugin_root_missing" }
  }

  if (!fileExists(markerPath)) {
    const message = payloadIntegrityFailureFor({
      omoAiVersion: deps.omoAiVersion,
      reinstallCommand: deps.reinstallCommand,
      expected: "",
      actual: "",
      reason: "missing_marker",
    })
    report(message)
    processExit(1)
    return { ok: false, expected: "", actual: "", reason: "missing_marker" }
  }

  let markerContent
  try {
    markerContent = readMarker(markerPath)
  } catch {
    const message = payloadIntegrityFailureFor({
      omoAiVersion: deps.omoAiVersion,
      reinstallCommand: deps.reinstallCommand,
      expected: "",
      actual: "",
      reason: "missing_marker",
    })
    report(message)
    processExit(1)
    return { ok: false, expected: "", actual: "", reason: "missing_marker" }
  }
  // The marker is "<hex>  plugin\n"; the first whitespace-separated token is the expected hex.
  const expected = markerContent.trim().split(/\s+/)[0] ?? ""
  // Empty-payload refusal: a published omo must not boot with an empty plugin/ tree, even when the
  // marker and the recomputed hash happen to agree (both are the SHA256 of an empty manifest). The
  // user must reinstall; never spawn the engine against a tree that has no payload.
  const entries = collectFileManifest(deps.pluginRoot).filter((entry) => !isMarkerFile(entry.path))
  if (entries.length === 0) {
    const message = payloadIntegrityFailureFor({
      omoAiVersion: deps.omoAiVersion,
      reinstallCommand: deps.reinstallCommand,
      expected,
      actual: expected,
      reason: "empty_payload",
    })
    report(message)
    processExit(1)
    return { ok: false, expected, actual: expected, reason: "empty_payload" }
  }

  const actual = hashPayload({ pluginRoot: deps.pluginRoot })

  if (expected !== actual) {
    const message = payloadIntegrityFailureFor({
      omoAiVersion: deps.omoAiVersion,
      reinstallCommand: deps.reinstallCommand,
      expected,
      actual,
      reason: "mismatch",
    })
    report(message)
    processExit(1)
    return { ok: false, expected, actual, reason: "mismatch" }
  }

  return { ok: true, expected, actual }
}
