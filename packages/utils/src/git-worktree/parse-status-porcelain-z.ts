import { toGitFileStatus } from "./parse-status-porcelain-line"
import type { GitFileStatus } from "./types"

/**
 * Parses `git status --porcelain -z` output. Records are NUL-terminated and
 * paths are never quoted. A rename/copy record (`R  new\0old\0`) carries the
 * source path as an extra field: it is skipped. A rename destination is mapped
 * like parseGitStatusPorcelainLine does; a copy destination is always "added",
 * because `git diff -M` (no `-C`) reports it as a plain new file with full line counts.
 */
export function parseGitStatusPorcelainZ(output: string): Map<string, GitFileStatus> {
  const map = new Map<string, GitFileStatus>()
  if (!output) return map

  const fields = output.split("\0")
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index]
    if (record.length < 4) continue

    const statusCode = record.substring(0, 2)
    map.set(record.substring(3), statusCode.includes("C") ? "added" : toGitFileStatus(statusCode.trim()))

    if (statusCode.includes("R") || statusCode.includes("C")) index++
  }

  return map
}
