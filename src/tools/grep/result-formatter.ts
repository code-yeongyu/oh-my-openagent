import type { GrepResult, GrepMatch, CountResult } from "./types"
import { safeCompress } from "../../shared/toon-compression"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

const DEFAULT_COMPRESSION_CONFIG: ToonCompressionConfig = {
  enabled: false,
  threshold: 5000,
}

export function formatGrepResult(
  result: GrepResult,
  compressionConfig: ToonCompressionConfig = DEFAULT_COMPRESSION_CONFIG,
): string {
  if (result.error) {
    return `Error: ${result.error}`
  }

  if (result.matches.length === 0) {
    return "No matches found"
  }

  const lines: string[] = []
  const isFilesOnlyMode = result.matches.every((match) => match.line === 0 && match.text.trim() === "")

  // Files-only mode: return filenames immediately, skip compression
  if (isFilesOnlyMode) {
    const files = [...new Set(result.matches.map((m) => m.file))]
    lines.push(`Found ${result.totalMatches} match(es) in ${result.filesSearched} file(s)`)
    if (result.truncated) {
      lines.push("[Output truncated due to size limit]")
    }
    lines.push("")
    for (const file of files) {
      lines.push(file)
      lines.push("")
    }
    return lines.join("\n")
  }

  // Add header for non-files-only mode
  lines.push(`Found ${result.totalMatches} match(es) in ${result.filesSearched} file(s)`)
  if (result.truncated) {
    lines.push("[Output truncated due to size limit]")
  }
  lines.push("")

  const matchesJson = JSON.stringify(result.matches)
  const shouldUseCompression = compressionConfig.enabled && result.matches.length >= 5

  if (shouldUseCompression) {
    const compressed = safeCompress(result.matches, compressionConfig)
    lines.push("[Compressed matches]")
    lines.push(compressed)
    return lines.join("\n")
  }

  const byFile = new Map<string, GrepMatch[]>()
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || []
    existing.push(match)
    byFile.set(match.file, existing)
  }

  for (const [file, matches] of byFile) {
    lines.push(file)
    for (const match of matches) {
      const trimmedText = match.text.trim()
      if (match.line === 0 && trimmedText === "") {
        continue
      }
      lines.push(`  ${match.line}: ${trimmedText}`)
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
