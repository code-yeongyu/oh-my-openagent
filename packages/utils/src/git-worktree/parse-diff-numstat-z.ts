import type { GitFileStat, GitFileStatus } from "./types"

function toCount(value: string): number {
  return value === "-" ? 0 : parseInt(value, 10)
}

/**
 * Parses `git diff --numstat -z` output. Entries are NUL-terminated and paths
 * are never quoted. A rename/copy entry has an empty path field followed by
 * the source and destination (`1\t2\t\0old\0new\0`) and is reported once, under
 * the destination.
 */
export function parseGitDiffNumstatZ(
  output: string,
  statusMap: Map<string, GitFileStatus>,
): GitFileStat[] {
  if (!output) return []

  const stats: GitFileStat[] = []
  const fields = output.split("\0")
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    const firstTab = field.indexOf("\t")
    const secondTab = field.indexOf("\t", firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue

    let path = field.slice(secondTab + 1)
    if (path === "") {
      index += 2
      path = fields[index]
    }
    if (!path) continue

    stats.push({
      path,
      added: toCount(field.slice(0, firstTab)),
      removed: toCount(field.slice(firstTab + 1, secondTab)),
      status: statusMap.get(path) ?? "modified",
    })
  }

  return stats
}
