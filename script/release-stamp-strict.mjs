#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import {
  isGeneratedReleasePath,
  isReleaseNotesPath,
  isVersionStampedPath,
  stampRefusals,
} from "./release-state-paths.mjs"

// The proof ci.yml needs before a release-state pull request skips the macOS/Windows matrix (#14847): the stamp commit
// changes nothing but versions over the pinned source. Stricter than `release-state-paths.mjs --check-stamp`, which
// publish.yml keeps and which must also pass: on top of that byte-exact version replacement (which also refuses duplicate
// JSON keys and reformatting), package.json is compared as JSON, bun.lock line by line, and generated bundles are
// content-checked. Only the STRICT_STAMP_OK line on stdout is a pass; ci.yml requires it, not just exit 0.

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
const show = (commit, path) => git(["show", `${commit}:${path}`])
const versionAt = (commit, manifest) => JSON.parse(show(commit, manifest)).version

// A bundle's freshness marker: `// <tag>:<source digest>:<body digest>`. Both digests move with the version (it is a
// build input and the code embeds it), so the marker may change while keeping its tag; every other line of the bundle
// is compared below, which is what proves no code byte moved beyond the version.
const marker = /^\/\/ ([\w-]+):([\w-]+):([\w-]+)$/

const ourPackage = (name) => /^(?:oh-my-opencode|oh-my-openagent)-/.test(name)

function manifestDifference(before, after) {
  const pin = JSON.parse(before)
  const stamp = JSON.parse(after)
  for (const [name, value] of Object.entries(stamp.optionalDependencies ?? {})) {
    if (!ourPackage(name) || pin.optionalDependencies?.[name] !== pin.version || value !== stamp.version) continue
    stamp.optionalDependencies[name] = pin.optionalDependencies[name]
  }
  stamp.version = pin.version
  return JSON.stringify(pin) === JSON.stringify(stamp) ? undefined : "changes more than its version"
}

function lineDifference(before, after, allowed) {
  const pin = before.split("\n")
  const stamp = after.split("\n")
  if (pin.length !== stamp.length) return "adds or removes lines"
  const at = pin.findIndex((line, index) => line !== stamp[index] && !allowed(line, stamp[index], index, pin))
  return at === -1 ? undefined : `line ${at + 1} changes more than a version`
}

// bun.lock: inside the workspaces section only a workspace entry's own `"version"` line (one level inside the entry) may
// move from a pinned version to its stamp, and a dependency on one of our own platform packages only from the pin's root
// version to the stamp's; every external package entry (name, version, integrity) sits under the top-level "packages"
// key and must stay byte-identical. A lockfile without both section headers is refused.
function lockDifference(before, after, versions) {
  const pin = before.split("\n")
  const workspacesStart = pin.indexOf('  "workspaces": {')
  const packagesStart = pin.indexOf('  "packages": {')
  if (workspacesStart === -1 || packagesStart < workspacesStart) return "has no workspaces section before its packages"
  const [rootVersion, rootStamp] = versions[0]
  const bumped = (line, from, to) => line.replace(`"${from}"`, `"${to}"`)
  return lineDifference(before, after, (pinLine, stampLine, index) => {
    if (index <= workspacesStart || index >= packagesStart) return false
    const workspaceVersion = /^ {6}"version": "([^"]+)",?$/.exec(pinLine)?.[1]
    if (workspaceVersion !== undefined)
      return versions.some(([from, to]) => workspaceVersion === from && stampLine === bumped(pinLine, from, to))
    const ownDependency = /^ {8}"(?:oh-my-opencode|oh-my-openagent)-[^"]+": "([^"]+)",?$/.exec(pinLine)?.[1]
    return ownDependency === rootVersion && stampLine === bumped(pinLine, rootVersion, rootStamp)
  })
}

function bundleDifference(before, after, versions) {
  return lineDifference(before, after, (pinLine, stampLine) => {
    if (versions.reduce((line, [from, to]) => line.replaceAll(from, to), pinLine) === stampLine) return true
    const pinMarker = marker.exec(pinLine)
    const stampMarker = marker.exec(stampLine)
    return pinMarker !== null && stampMarker !== null && pinMarker[1] === stampMarker[1]
  })
}

function strictStampRefusals(pin, stamp) {
  const versions = [
    [versionAt(pin, "package.json"), versionAt(stamp, "package.json")],
    [versionAt(pin, "packages/omo-native/package.json"), versionAt(stamp, "packages/omo-native/package.json")],
  ]
  const fields = git(["diff", "--no-renames", "--name-status", "-z", pin, stamp]).split("\0").filter(Boolean)
  const refusals = [...stampRefusals(pin, stamp)]
  for (let index = 0; index < fields.length; index += 2) {
    const [status, path] = [fields[index], fields[index + 1]]
    if (isReleaseNotesPath(path)) continue
    if (status !== "M") {
      refusals.push(`${path}: ${status === "A" ? "added" : "deleted"}, a stamp only edits files`)
      continue
    }
    const [before, after] = [show(pin, path), show(stamp, path)]
    let reason
    if (/(?:^|\/)package\.json$/.test(path) && isVersionStampedPath(path)) reason = manifestDifference(before, after)
    else if (path === "bun.lock") reason = lockDifference(before, after, versions)
    else if (isVersionStampedPath(path) || isGeneratedReleasePath(path))
      reason = bundleDifference(before, after, versions)
    else reason = "outside the release stamp's files"
    if (reason !== undefined) refusals.push(`${path}: ${reason}`)
  }
  return refusals
}

// Node runs a symlinked entry point from its real path, so compare against that.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [pin, stamp] = process.argv.slice(2)
  if (pin === undefined || stamp === undefined) throw new Error("usage: release-stamp-strict.mjs <pin> <stamp>")
  const refusals = strictStampRefusals(pin, stamp)
  if (refusals.length > 0) {
    process.stderr.write(`Not a strict release stamp (script/release-stamp-strict.mjs):\n${refusals.join("\n")}\n`)
    process.exit(1)
  }
  process.stdout.write("STRICT_STAMP_OK\n")
}
