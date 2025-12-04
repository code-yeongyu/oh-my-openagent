import type { GrepResult, GrepMatch, CountResult } from "./types"

export function formatGrepResult(result: GrepResult): string {
  if (result.error) {
    return `Error: ${result.error}`
  }

  if (result.matches.length === 0) {
    return "No matches found"
  }

  const lines: string[] = []

  lines.push(`Found ${result.totalMatches} match(es) in ${result.filesSearched} file(s)`)
  if (result.truncated) {
    lines.push("[Output truncated due to size limit]")
  }
  lines.push("")

  const byFile = new Map<string, GrepMatch[]>()
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || []
    existing.push(match)
    byFile.set(match.file, existing)
  }

  for (const [file, matches] of byFile) {
    lines.push(file)
    for (const match of matches) {
      lines.push(`  ${match.line}: ${match.text.trim()}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export function formatCountResult(results: CountResult[]): string {
  if (results.length === 0) {
    return "No matches found"
  }

  const total = results.reduce((sum, r) => sum + r.count, 0)
  const lines: string[] = [`Found ${total} match(es) in ${results.length} file(s):`, ""]

  const sorted = [...results].sort((a, b) => b.count - a.count)

  for (const { file, count } of sorted) {
    lines.push(`  ${count.toString().padStart(6)}: ${file}`)
  }

  return lines.join("\n")
}
