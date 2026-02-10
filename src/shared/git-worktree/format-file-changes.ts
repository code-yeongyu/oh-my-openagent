import type { GitFileStat } from "./types"

export function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const modified = stats.filter((s) => s.status === "modified")
  const added = stats.filter((s) => s.status === "added")
  const deleted = stats.filter((s) => s.status === "deleted")

  const lines: string[] = ["[FILE CHANGES SUMMARY]"]

  if (modified.length > 0) {
    lines.push("Modified files:")
    for (const f of modified) {
      lines.push(`  ${f.path}  (+${f.added}, -${f.removed})`)
    }
    lines.push("")
  }

  if (added.length > 0) {
    lines.push("Created files:")
    for (const f of added) {
      lines.push(`  ${f.path}  (+${f.added})`)
    }
    lines.push("")
  }

  if (deleted.length > 0) {
    lines.push("Deleted files:")
    for (const f of deleted) {
      lines.push(`  ${f.path}  (-${f.removed})`)
    }
    lines.push("")
  }

  if (notepadPath) {
    const notepadStat = stats.find((s) => s.path.includes("notepad") || s.path.includes(".sisyphus"))
    if (notepadStat) {
      lines.push("[NOTEPAD UPDATED]")
      lines.push(`  ${notepadStat.path}  (+${notepadStat.added})`)
      lines.push("")
    }
  }

  return lines.join("\n")
}
