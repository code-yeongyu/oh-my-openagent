#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const generatedReleaseMerge =
  /^Merge pull request #[0-9]+ from code-yeongyu\/release\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?-source-state$/
const releaseStateHeadRef = /^release\/v.+-source-state$/
const fullMatrixLabel = "ci:full-matrix"
// Diffs that can change how a non-Linux runner behaves, or that change the
// skip decision itself, must be proven on all three operating systems.
const platformSensitiveExactPaths = new Set([
  ".github/workflows/ci.yml",
  "script/ci-fast-path.mjs",
  "bunfig.win2.parallel.toml",
])

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

function isPlatformSensitivePath(path) {
  if (platformSensitiveExactPaths.has(path)) return true
  if (path.endsWith(".ps1")) return true
  const basename = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  return basename.includes("windows") || basename.includes("win32")
}

export function classifyCiMode({
  eventName,
  headCommitMessage,
  changedPaths,
  diffAvailable,
  mergeParentCount,
  headRef = "",
  labels = [],
}) {
  const subject = headCommitMessage.split("\n", 1)[0] ?? ""
  // Provenance is machine-derived, never prose alone: an actual merge commit
  // (exactly two parents) whose subject matches the generated release shape.
  const isRealMerge = mergeParentCount === 2
  const generatedReleasePush =
    eventName === "push" &&
    diffAvailable &&
    isRealMerge &&
    generatedReleaseMerge.test(subject)
  const webOnly = diffAvailable && changedPaths.length > 0 && changedPaths.every(isWebPath)
  // Ubuntu-first is a pull-request optimization only, and it fails open: any
  // event we cannot fully inspect keeps all three operating systems.
  const fullMatrix =
    eventName === "push" ||
    !diffAvailable ||
    releaseStateHeadRef.test(headRef) ||
    labels.includes(fullMatrixLabel) ||
    changedPaths.some(isPlatformSensitivePath)

  return {
    generatedReleasePush,
    webOnly,
    runHeavy: !(generatedReleasePush || webOnly),
    fullMatrix,
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
  })
  process.stdout.write(`${JSON.stringify(mode)}\n`)
}
