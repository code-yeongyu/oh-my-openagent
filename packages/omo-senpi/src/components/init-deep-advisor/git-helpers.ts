import { execFileSync } from "node:child_process"
import { readFileSync, realpathSync } from "node:fs"
import { extname, join, resolve } from "node:path"

import { SOURCE_EXTENSIONS } from "./constants"

const DRIFT_EXCLUDES = [
  ":(exclude)AGENTS.md",
  ":(exclude,glob)**/AGENTS.md",
  ":(exclude).omo/init-deep.json",
]

function run(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: "utf8" })
}

function countNul(output: string): number {
  let count = 0
  for (const char of output) {
    if (char === "\0") count += 1
  }
  return count
}

export function gitIsRepo(root: string): boolean {
  try {
    run(root, ["rev-parse", "--is-inside-work-tree"])
    return true
  } catch {
    return false
  }
}

export function gitHead(root: string): string {
  return run(root, ["rev-parse", "HEAD"]).trim()
}

export function gitCommitsSince(root: string, sha: string): number {
  return Number(run(root, ["rev-list", "--count", `${sha}..HEAD`]).trim())
}

export function gitTrackedFileCount(root: string): number {
  return countNul(run(root, ["ls-files", "-z"]))
}

export function gitTouchedFilesSince(root: string, sha: string): string[] {
  const output = run(root, [
    "diff",
    "--name-only",
    "-z",
    "--find-renames",
    sha,
    "HEAD",
    "--",
    ".",
    ...DRIFT_EXCLUDES,
  ])
  return output.split("\0").filter((entry) => entry.length > 0)
}

export function gitChurnLoc(root: string, sha: string): number {
  const output = run(root, [
    "diff",
    "--numstat",
    "-z",
    "--find-renames",
    sha,
    "HEAD",
    "--",
    ".",
    ...DRIFT_EXCLUDES,
  ])
  const tokens = output.split("\0")
  let churn = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index]!
    if (record.length === 0) continue
    const [added, deleted, path] = record.split("\t")
    if (path === "") index += 2
    if (added === "-" || deleted === "-") continue
    churn += Number(added) + Number(deleted)
  }
  return churn
}

export function gitTotalLoc(root: string): number {
  const files = run(root, ["ls-files", "-z"])
    .split("\0")
    .filter((entry) => entry.length > 0 && SOURCE_EXTENSIONS.has(extname(entry)))
  let total = 0
  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8")
    for (const char of content) {
      if (char === "\n") total += 1
    }
  }
  return total
}

export function gitObjectType(root: string, sha: string): string | null {
  try {
    return run(root, ["cat-file", "-t", sha]).trim()
  } catch {
    return null
  }
}

export function gitCommonDirRealpath(root: string): string {
  const commonDir = run(root, ["rev-parse", "--git-common-dir"]).trim()
  return realpathSync(resolve(root, commonDir))
}
