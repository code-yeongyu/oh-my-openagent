import type { GlobResult } from "./types"

export function formatGlobResult(result: GlobResult): string {
  if (result.error) {
    return `Error: ${result.error}`
  }

  if (result.files.length === 0) {
    return "No files found"
  }

  const lines: string[] = []
  lines.push(`Found ${result.totalFiles} file(s)`)
  lines.push("")

  for (const file of result.files) {
    lines.push(file.path)
  }

  if (result.truncated) {
    lines.push("")
    lines.push("(Results are truncated. Consider using a more specific path or pattern.)")
  }

  return lines.join("\n")
}
