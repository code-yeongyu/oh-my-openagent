#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// What publish.yml's prepare-release-state may change when it stamps a release. The release cut refuses a stamp that
// touches anything else (`--check`), ci-fast-path.mjs keeps a release-state pull request on Linux only when its whole
// diff is inside these lists, and `--check-stamp` proves a diff is a stamp by content, so the three cannot drift apart.

// Prose: assembled changelog and release fragments; nothing executes them.
const PROSE_PATHS = [/^CHANGELOG\.md$/, /^changes\.md$/, /^changes\//, /^packages\/[^/]+\/changes\.md$/]

// Hand-written files the stamp edits only by replacing the version: the content check below must find nothing else.
const VERSION_STAMPED_PATHS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^packages\/omo-native\/package\.json$/,
  /^packages\/oh-my-opencode-[^/]+\/package\.json$/,
  /^packages\/omo-senpi\/package\.json$/,
  /^packages\/omo-senpi\/plugin\/package\.json$/,
  /^packages\/omo-codex\/package\.json$/,
  /^packages\/omo-codex\/plugin\/package\.json$/,
  /^packages\/omo-codex\/plugin\/package-lock\.json$/,
  /^packages\/omo-codex\/plugin\/\.codex-plugin\/plugin\.json$/,
  /^packages\/omo-codex\/plugin\/components\/[^/]+\/package\.json$/,
  /^packages\/omo-codex\/plugin\/hooks\/[^/]+\.json$/,
  /^packages\/omo-codex\/plugin\/components\/[^/]+\/hooks\/hooks\.json$/,
]

// Generated code that runs on macOS and Windows: only the outputs a required Linux job rebuilds and compares, so a
// stale or hand-edited copy fails there. extensions/*.js|mjs and these runtime files: senpi-compatibility (ubuntu-latest)
// "Verify committed Senpi plugin bundle is current" (build-extension.mjs --check). runtime/dag/ is not compared there.
// install-local.mjs: script/codex-install-bundle-freshness.test.ts. service-auth.generated.js:
// script/build-service-auth.test.ts "the native auth bundle matches its source" (test, ubuntu-latest).
const LINUX_VERIFIED_GENERATED_PATHS = [
  /^packages\/omo-senpi\/plugin\/extensions\/[^/]+\.m?js$/,
  /^packages\/omo-senpi\/plugin\/runtime\/(?:agent-toolkit-sdk|bunshin-ts|omo-sdk|thread-sdk)\/sdk\.js$/,
  /^packages\/omo-senpi\/plugin\/runtime\/rollback-migrate\.js$/,
  /^packages\/omo-codex\/scripts\/install-dist\/install-local\.mjs$/,
  /^packages\/omo-native\/bin\/lib\/service-auth\.generated\.js$/,
]

const matches = (patterns, path) => patterns.some((pattern) => pattern.test(path))

export function isReleaseStatePath(path) {
  return (
    matches(PROSE_PATHS, path) || matches(VERSION_STAMPED_PATHS, path) || matches(LINUX_VERIFIED_GENERATED_PATHS, path)
  )
}

const git = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
const versionAt = (commit, manifest) => JSON.parse(git(["show", `${commit}:${manifest}`])).version

// Every reason base..head is not a release stamp; empty when it is one. Renames are listed as a delete plus an add, so a
// source file moved into a listed path still shows its deletion.
function stampRefusals(base, head) {
  const fields = git(["diff", "--no-renames", "--name-status", "-z", base, head]).split("\0").filter(Boolean)
  const versions = ["package.json", "packages/omo-native/package.json"]
    .map((manifest) => [versionAt(base, manifest), versionAt(head, manifest)])
    .sort(([left], [right]) => right.length - left.length)
  const refusals = []
  for (let index = 0; index < fields.length; index += 2) {
    const [status, path] = [fields[index], fields[index + 1]]
    if (!isReleaseStatePath(path)) refusals.push(`${path}: outside RELEASE_STATE_PATHS`)
    else if (!matches(VERSION_STAMPED_PATHS, path)) continue
    else if (status !== "M") refusals.push(`${path}: ${status === "A" ? "added" : "deleted"}, a stamp only edits it`)
    else {
      const expected = versions.reduce(
        (text, [from, to]) => text.replaceAll(from, to),
        git(["show", `${base}:${path}`]),
      )
      if (git(["show", `${head}:${path}`]) !== expected) refusals.push(`${path}: changes more than the version`)
    }
  }
  return refusals
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, base, head] = process.argv.slice(2)
  let refusals
  if (mode === "--check") {
    // NUL-separated paths on stdin (git diff --no-renames --name-only -z).
    refusals = readFileSync(0, "utf8")
      .split("\0")
      .filter((path) => path.length > 0 && !isReleaseStatePath(path))
      .map((path) => `${path}: outside RELEASE_STATE_PATHS`)
  } else if (mode === "--check-stamp" && base !== undefined && head !== undefined) {
    refusals = stampRefusals(base, head)
  } else {
    throw new Error("usage: release-state-paths.mjs --check < paths | --check-stamp <base> <head>")
  }
  if (refusals.length > 0) {
    process.stderr.write(`Not a release stamp (script/release-state-paths.mjs):\n${refusals.join("\n")}\n`)
    process.exit(1)
  }
}
