import type { GitFileStatus } from "./types"

export function parseGitStatusPorcelain(output: string): Map<string, GitFileStatus> {
  const map = new Map<string, GitFileStatus>()
  if (!output) return map

  for (const line of output.split("\n")) {
    if (!line) continue

    const status = line.substring(0, 2).trim()
    const filePath = line.substring(3)

    if (!filePath) continue

    if (status === "A" || status === "??") {
      map.set(filePath, "added")
    } else if (status === "D") {
      map.set(filePath, "deleted")
    } else {
      map.set(filePath, "modified")
    }
  }

  return map
}
