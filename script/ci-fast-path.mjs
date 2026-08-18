#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"

const generatedReleaseMerge =
  /^Merge pull request #[0-9]+ from code-yeongyu\/release\/v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?-source-state$/

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

export function classifyCiMode({ eventName, headCommitMessage, changedPaths, diffAvailable, mergeParentCount }) {
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

  return {
    generatedReleasePush,
    webOnly,
    runHeavy: !(generatedReleasePush || webOnly),
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
  })
  process.stdout.write(`${JSON.stringify(mode)}\n`)
}
