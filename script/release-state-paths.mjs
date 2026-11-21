#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

// Every path publish.yml's prepare-release-state may change when it stamps a release (version manifests, lockfiles,
// the assembled changelog, and the bundles regenerated because they embed the version). The release cut refuses a
// stamp that touches anything else (`--check`), and ci-fast-path.mjs keeps a release-state pull request on Linux only
// when its whole diff is inside this list, so the two cannot drift apart.
export const RELEASE_STATE_PATHS = [
  /^CHANGELOG\.md$/,
  /^changes\.md$/,
  /^changes\//,
  /^packages\/[^/]+\/changes\.md$/,
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
  /^packages\/omo-senpi\/plugin\/extensions\//,
  /^packages\/omo-senpi\/plugin\/runtime\//,
  /^packages\/omo-codex\/scripts\/install-dist\/install-local\.mjs$/,
  /^packages\/omo-native\/bin\/lib\//,
]

export function isReleaseStatePath(path) {
  return RELEASE_STATE_PATHS.some((pattern) => pattern.test(path))
}

// `--check`: read NUL-separated paths on stdin (git diff --name-only -z) and fail naming every path outside the list.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== "--check") throw new Error("usage: release-state-paths.mjs --check < paths (NUL-separated)")
  const outside = readFileSync(0, "utf8")
    .split("\0")
    .filter((path) => path.length > 0 && !isReleaseStatePath(path))
  if (outside.length > 0) {
    process.stderr.write(
      `The release stamp changed paths outside RELEASE_STATE_PATHS (script/release-state-paths.mjs): ${outside.join(" ")}\n`,
    )
    process.exit(1)
  }
}
