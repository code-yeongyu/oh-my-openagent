import type { GitFileStat } from "./types"

const MAX_FILES_PER_STATUS = 20
const MAX_DISPLAY_PATH_CHARS = 300

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/")
}

function displayPath(path: string): string {
  if (path.length <= MAX_DISPLAY_PATH_CHARS) return path
  const suffix = "... [path truncated]"
  return path.slice(0, MAX_DISPLAY_PATH_CHARS - suffix.length) + suffix
}

function appendFileSection(
  lines: string[],
  files: GitFileStat[],
  label: "Modified" | "Created" | "Deleted",
  formatStat: (stat: GitFileStat) => string,
): void {
  if (files.length === 0) return

  const visibleFiles = files.slice(0, MAX_FILES_PER_STATUS)
  const omittedCount = files.length - visibleFiles.length
  lines.push(omittedCount > 0
    ? `${label} files (${files.length} total, showing ${visibleFiles.length}):`
    : `${label} files:`)
  for (const file of visibleFiles) {
    lines.push(`  ${displayPath(file.path)}  (${formatStat(file)})`)
  }
  if (omittedCount > 0) {
    lines.push(`  ... ${omittedCount} more ${label.toLowerCase()} file${omittedCount === 1 ? "" : "s"} omitted.`)
  }
  lines.push("")
}

export function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const modified = stats.filter((s) => s.status === "modified")
  const added = stats.filter((s) => s.status === "added")
  const deleted = stats.filter((s) => s.status === "deleted")

  const lines: string[] = ["[FILE CHANGES SUMMARY]"]

  appendFileSection(lines, modified, "Modified", (file) => `+${file.added}, -${file.removed}`)
  appendFileSection(lines, added, "Created", (file) => `+${file.added}`)
  appendFileSection(lines, deleted, "Deleted", (file) => `-${file.removed}`)

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
