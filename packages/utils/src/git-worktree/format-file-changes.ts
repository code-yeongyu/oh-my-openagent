import { escapeForDisplay } from "../escape-for-display"
import type { GitFileStat } from "./types"

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/")
}

// `git ... -z` never quotes paths, so a name holding a newline, another control character or a format character
// would otherwise print as extra lines or reordered text inside a summary that is injected into an LLM prompt.
function displayPath(path: string): string {
  const escaped = escapeForDisplay(path)
  return escaped === path ? path : escapeForDisplay(JSON.stringify(path))
}

export function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const modified = stats.filter((s) => s.status === "modified")
  const added = stats.filter((s) => s.status === "added")
  const deleted = stats.filter((s) => s.status === "deleted")

  const lines: string[] = ["[FILE CHANGES SUMMARY]"]

  if (modified.length > 0) {
    lines.push("Modified files:")
    for (const f of modified) {
      lines.push(`  ${displayPath(f.path)}  (+${f.added}, -${f.removed})`)
    }
    lines.push("")
  }

  if (added.length > 0) {
    lines.push("Created files:")
    for (const f of added) {
      lines.push(`  ${displayPath(f.path)}  (+${f.added})`)
    }
    lines.push("")
  }

  if (deleted.length > 0) {
    lines.push("Deleted files:")
    for (const f of deleted) {
      lines.push(`  ${displayPath(f.path)}  (-${f.removed})`)
    }
    lines.push("")
  }

  if (notepadPath) {
    const normalizedNotepadPath = normalizePath(notepadPath)
    const notepadStat = stats.find((s) => {
      const normalizedPath = normalizePath(s.path)
      return normalizedPath === normalizedNotepadPath
    })
    if (notepadStat) {
      lines.push("[NOTEPAD UPDATED]")
      lines.push(`  ${displayPath(notepadStat.path)}  (+${notepadStat.added})`)
      lines.push("")
    }
  }

  return lines.join("\n")
}
