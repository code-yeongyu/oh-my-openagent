import { spawnSync } from "node:child_process"
import { join } from "node:path"

import { readFileSync } from "../fs/resilient"

export interface StagedEntry {
  readonly status: string
  readonly path: string
  readonly from?: string
  readonly srcBlob: string
  readonly dstBlob: string
  readonly dstMode: string
}

const ZERO = /^0+$/

export function git(cwd: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", ["--literal-pathspecs", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true })
  return result.status === 0 ? result.stdout : undefined
}

// `git diff --raw -z` records: ":<srcmode> <dstmode> <srcblob> <dstblob> <status>" NUL path NUL [path NUL].
// Blobs are then read by object id, so no path (stage-prefixed `1:x.md`, quoted, non-ASCII) is ever re-parsed.
export function parseRawZ(output: string): StagedEntry[] {
  const tokens = output.split("\0")
  const entries: StagedEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const meta = tokens[index++] ?? ""
    if (!meta.startsWith(":")) break
    const [, dstMode = "", srcBlob = "", dstBlob = "", status = ""] = meta.slice(1).split(" ")
    const first = tokens[index++] ?? ""
    const base = { status, srcBlob, dstBlob, dstMode }
    entries.push(status.startsWith("R") || status.startsWith("C") ? { ...base, from: first, path: tokens[index++] ?? "" } : { ...base, path: first })
  }
  return entries
}

export function stagedEntries(cwd: string): StagedEntry[] {
  const listed = git(cwd, ["-c", "core.quotePath=false", "diff", "--cached", "-M", "-C", "-z", "--raw", "--no-abbrev"])
  if (listed === undefined) throw new Error("memory hook: could not list the staged paths")
  return parseRawZ(listed)
}

export function readBlob(cwd: string, oid: string | undefined): string | undefined {
  return oid === undefined || oid === "" || ZERO.test(oid) ? undefined : git(cwd, ["cat-file", "blob", oid])
}

export function treeBlob(cwd: string, rev: string, path: string): string | undefined {
  const listed = git(cwd, ["ls-tree", "-z", rev, "--", path])
  const match = listed === undefined ? null : /^\d+ blob ([0-9a-f]+)\t/.exec(listed)
  return match?.[1]
}

export function mergeHeads(cwd: string): string[] {
  const path = git(cwd, ["rev-parse", "--git-path", "MERGE_HEAD"])?.trim()
  if (path === undefined || path === "") return []
  try {
    const absolute = path.startsWith("/") || /^[A-Za-z]:/.test(path) ? path : join(cwd, path)
    return readFileSync(absolute, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}
