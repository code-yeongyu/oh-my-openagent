import { computeLineHash } from "./hash-computation"

export function toHashlineContent(content: string): string {
  if (!content) return content
  const lines = content.split("\n")
  const lastLine = lines[lines.length - 1]
  const hasTrailingNewline = lastLine === ""
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines
  const hashlined = contentLines.map((line, i) => {
    const lineNum = i + 1
    const hash = computeLineHash(lineNum, line)
    return `${lineNum}#${hash}|${line}`
  })
  return hasTrailingNewline ? `${hashlined.join("\n")}\n` : hashlined.join("\n")
}

export function generateUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const parts: string[] = [`--- ${filePath}\n+++ ${filePath}\n`]
  const maxLines = Math.max(oldLines.length, newLines.length)

  for (let i = 0; i < maxLines; i += 1) {
    const oldLine = oldLines[i] ?? ""
    const newLine = newLines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(lineNum, newLine)

    if (i >= oldLines.length) {
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
      continue
    }
    if (i >= newLines.length) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      continue
    }
    if (oldLine !== newLine) {
      parts.push(`- ${lineNum}#  |${oldLine}\n`)
      parts.push(`+ ${lineNum}#${hash}|${newLine}\n`)
    }
  }

  return parts.join("")
}

export function countLineDiffs(oldContent: string, newContent: string): { additions: number; deletions: number } {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  const oldSet = new Map<string, number>()
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1)
  }

  const newSet = new Map<string, number>()
  for (const line of newLines) {
    newSet.set(line, (newSet.get(line) ?? 0) + 1)
  }

  let deletions = 0
  for (const [line, count] of oldSet) {
    const newCount = newSet.get(line) ?? 0
    if (count > newCount) {
      deletions += count - newCount
    }
  }

  let additions = 0
  for (const [line, count] of newSet) {
    const oldCount = oldSet.get(line) ?? 0
    if (count > oldCount) {
      additions += count - oldCount
    }
  }

  return { additions, deletions }
}
