import { computeLineHash } from "./hash-computation"

export function generateHashlineDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  let diff = `--- ${filePath}\n+++ ${filePath}\n`
  const maxLines = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLines; i += 1) {
    const oldLine = oldLines[i] ?? ""
    const newLine = newLines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(lineNum, newLine)

    if (i >= oldLines.length) {
      diff += `+ ${lineNum}#${hash}|${newLine}\n`
      continue
    }
    if (i >= newLines.length) {
      diff += `- ${lineNum}#  |${oldLine}\n`
      continue
    }
    if (oldLine !== newLine) {
      diff += `- ${lineNum}#  |${oldLine}\n`
      diff += `+ ${lineNum}#${hash}|${newLine}\n`
    }
  }

  return diff
}
