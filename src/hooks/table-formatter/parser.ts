import type { ParsedTable } from "./types"

const TABLE_ROW_REGEX = /^\s*\|(.+)\|\s*$/

function parseAlignment(cell: string): "left" | "center" | "right" {
  const trimmed = cell.trim()
  const hasLeftColon = trimmed.startsWith(":")
  const hasRightColon = trimmed.endsWith(":")

  if (hasLeftColon && hasRightColon) return "center"
  if (hasRightColon) return "right"
  return "left"
}

function parseCells(row: string): string[] {
  const match = row.match(TABLE_ROW_REGEX)
  if (!match) return []
  return match[1].split("|").map((cell) => cell.trim())
}

function isSeparatorRow(row: string): boolean {
  if (!TABLE_ROW_REGEX.test(row)) return false
  const cells = parseCells(row)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

export function parseMarkdownTables(text: string): ParsedTable[] {
  const lines = text.split("\n")
  const tables: ParsedTable[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!TABLE_ROW_REGEX.test(line)) {
      i++
      continue
    }

    if (i + 1 >= lines.length || !isSeparatorRow(lines[i + 1])) {
      i++
      continue
    }

    const tableStartLine = i
    const headers = parseCells(line)
    const separatorLine = lines[i + 1]
    const separatorCells = parseCells(separatorLine)
    const alignments = separatorCells.map(parseAlignment)

    const rows: string[][] = []
    let j = i + 2

    while (j < lines.length && TABLE_ROW_REGEX.test(lines[j])) {
      rows.push(parseCells(lines[j]))
      j++
    }

    const tableEndLine = j - 1
    const tableLines = lines.slice(tableStartLine, tableEndLine + 1)
    const original = tableLines.join("\n")

    let startIndex = 0
    for (let k = 0; k < tableStartLine; k++) {
      startIndex += lines[k].length + 1
    }
    const endIndex = startIndex + original.length

    tables.push({
      startIndex,
      endIndex,
      original,
      headers,
      alignments,
      rows,
    })

    i = j
  }

  return tables
}
