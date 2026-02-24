import type { GlobResult } from "./types"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"
import type { ToonCompressionConfig } from "../../shared/toon-compression"

export function formatGlobResult(
  result: GlobResult,
  compressionConfig?: ToonCompressionConfig
): string {
  if (result.error) {
    return `Error: ${result.error}`
  }

  if (result.files.length === 0) {
    return "No files found"
  }

  const lines: string[] = []
  lines.push(`Found ${result.totalFiles} file(s)`)
  lines.push("")

  const shouldUseCompression =
    compressionConfig?.enabled === true &&
    shouldCompress(result.files, compressionConfig.threshold)

  if (shouldUseCompression) {
    lines.push(safeCompress(result.files, compressionConfig))
  } else {
    for (const file of result.files) {
      lines.push(file.path)
    }
  }

  if (result.truncated) {
    lines.push("")
    lines.push("(Results are truncated. Consider using a more specific path or pattern.)")
  }

  return lines.join("\n")
}
