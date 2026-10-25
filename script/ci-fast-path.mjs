#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { coveredByInvocation, readCiInvocationCoverage } from "./ci-platform-invocations.mjs"

const generatedReleaseMerge =
  /^Merge pull request #[0-9]+ from code-yeongyu\/release\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?-source-state$/
const releaseStateHeadRef = /^release\/v.+-source-state$/
const fullMatrixLabels = new Set(["ci:full-matrix", "run-full-ci"])
// On a pull request, macOS and Windows run only for diffs that can change how a
// non-Linux runner behaves or that change the skip decision itself (#10856).
// Everything else is proven on those operating systems by the post-merge push,
// which always runs the full matrix. Paths a macOS/Windows-only step names are
// derived from ci.yml (ci-platform-invocations.mjs); this list holds only what
// no such step names: native code, packaging, and the CI decision itself.
const platformSensitiveExactPaths = new Set([
  ".github/workflows/ci.yml",
  ".github/workflows/ci-full-matrix-label.yml",
  ".github/workflows/publish-platform.yml",
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "postinstall.mjs",
  "script/build-binaries.ts",
  "script/build-omo-native.ts",
  "script/ci-fast-path.mjs",
  "script/ci-platform-invocations.mjs",
  "script/ci-leg-tests-guard.mjs",
  "script/root-test-serial-quarantine.ts",
  "packages/openclaw-core/src/reply-listener-process.ts",
])
const platformSensitivePrefixes = [
  "crates/",
  "bin/",
  ".github/actions/",
  ".github/scripts/",
  "packages/git-bash-mcp/",
  "packages/omo-codex/src/install/",
  "packages/omo-native/",
  "packages/omo-codex/scripts/install-",
  "script/qa/desktop/macos/",
  "script/qa/desktop/windows/",
]
const platformPackagePath = /^packages\/oh-my-opencode-(?:darwin|linux|windows)-/
const platformBasename = /windows|win32|darwin|macos|\.platform\./

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined || !key.startsWith("--")) {
      throw new Error("expected --key value arguments")
    }
    values.set(key.slice(2), value)
  }
  return values
}

function parseMergeParents(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`expected non-negative integer merge parents, received ${value}`)
  }
  return count
}

function parseLabels(value) {
  const parsed = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== "string")) {
    throw new Error(`expected a JSON array of label names, received ${value}`)
  }
  return parsed
}

function parseBoolean(value) {
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`expected boolean, received ${value}`)
}

function readChangedPaths(input) {
  if (input.length === 0) return []
  return input.toString("utf8").split("\0").filter((path) => path.length > 0)
}

function isWebPath(path) {
  return (
    path.startsWith("packages/web/") ||
    path.startsWith("docs/") ||
    path === ".github/workflows/web-ci.yml"
  )
}

// The non-runtime paths: an explicit
// allowlist of prose and repository metadata no test loads. Anything not
// matched here, including a new folder or an unknown extension, is runtime.
// Nothing under packages/*/src is ever non-runtime: prompts and skills ship
// from there.
const packageSourcePath = /^packages\/[^/]+\/src\//
const topLevelProse = /^[^/]+\.mdx?$/i
const proseBasename =
  /^(?:readme|changelog|changes|agents|claude|contributing|code_of_conduct|security|roadmap|third-party-notices|cla)(?:\.[a-z]{2}(?:-[a-z]{2})?)?\.mdx?$|^license(?:\.md|\.txt)?$/i
const repositoryMetadata = [
  /^\.github\/workflows\/(?!ci\.yml$)[^/]+\.ya?ml$/,
  /^\.github\/ISSUE_TEMPLATE\/[^/]+\.ya?ml$/,
  /^\.github\/assets\/[^/]+\.(?:png|jpe?g|gif|svg|webp)$/i,
  /^\.github\/FUNDING\.yml$/,
  /^\.github\/pull_request_template\.md$/,
]

function isProsePath(path) {
  if (packageSourcePath.test(path)) return false
  if (topLevelProse.test(path)) return true
  return proseBasename.test(path.slice(path.lastIndexOf("/") + 1))
}

// A runtime-touching path can change what a test observes. It is reported in
// the CI summary; the OS matrix is decided by isPlatformSensitivePath.
export function isRuntimePath(path) {
  if (isWebPath(path) || isProsePath(path)) return false
  return !repositoryMetadata.some((pattern) => pattern.test(path))
}

export function isPlatformSensitivePath(path, invocationCoverage) {
  if (platformSensitiveExactPaths.has(path)) return true
  if (coveredByInvocation(path, invocationCoverage)) return true
  if (platformSensitivePrefixes.some((prefix) => path.startsWith(prefix))) return true
  if (platformPackagePath.test(path) || path.endsWith(".ps1")) return true
  return platformBasename.test(path.slice(path.lastIndexOf("/") + 1).toLowerCase())
}

export function classifyCiMode({
  eventName,
  headCommitMessage,
  changedPaths,
  diffAvailable,
  mergeParentCount,
  headRef = "",
  labels = [],
  invocationCoverage = [],
}) {
  // Queue commits never use generated-release push policy.
  const classificationEvent = eventName === "merge_group" ? "pull_request" : eventName
  const subject = headCommitMessage.split("\n", 1)[0] ?? ""
  // Provenance is machine-derived, never prose alone: an actual merge commit
  // (exactly two parents) whose subject matches the generated release shape.
  const isRealMerge = mergeParentCount === 2
  const generatedReleasePush =
    classificationEvent === "push" &&
    diffAvailable &&
    isRealMerge &&
    generatedReleaseMerge.test(subject)
  const webOnly = diffAvailable && changedPaths.length > 0 && changedPaths.every(isWebPath)
  const runtimeTouching = !diffAvailable || changedPaths.some(isRuntimePath)
  // Ubuntu-first is a pull-request optimization for every change that touches
  // no platform-specific path, and it fails open: any diff we cannot inspect
  // keeps all three operating systems.
  const fullMatrix =
    eventName === "merge_group" ||
    classificationEvent === "push" ||
    !diffAvailable ||
    releaseStateHeadRef.test(headRef) ||
    labels.some((label) => fullMatrixLabels.has(label)) ||
    changedPaths.some((path) => isPlatformSensitivePath(path, invocationCoverage))

  return {
    generatedReleasePush,
    webOnly,
    runHeavy: eventName === "merge_group" || !(generatedReleasePush || webOnly),
    fullMatrix,
    runtimeTouching,
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArguments(process.argv.slice(2))
  const eventName = args.get("event")
  const headCommitMessage = args.get("message")
  const diffAvailable = args.get("diff-available")
  const mergeParents = args.get("merge-parents")
  if (
    eventName === undefined ||
    headCommitMessage === undefined ||
    diffAvailable === undefined ||
    mergeParents === undefined
  ) {
    throw new Error("--event, --message, --diff-available, and --merge-parents are required")
  }

  const mode = classifyCiMode({
    eventName,
    headCommitMessage,
    changedPaths: readChangedPaths(readFileSync(0)),
    diffAvailable: parseBoolean(diffAvailable),
    mergeParentCount: parseMergeParents(mergeParents),
    headRef: args.get("head-ref") ?? "",
    labels: parseLabels(args.get("labels") ?? "[]"),
    invocationCoverage: readCiInvocationCoverage(),
  })
  process.stdout.write(`${JSON.stringify(mode)}\n`)
}
