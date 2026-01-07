import stringWidth from "string-width"
import type { ParsedTable } from "./types"

function padCell(
  content: string,
  width: number,
  alignment: "left" | "center" | "right"
): string {
  const contentWidth = stringWidth(content)
  const paddingNeeded = width - contentWidth

  if (paddingNeeded <= 0) return content

  switch (alignment) {
    case "right":
      return " ".repeat(paddingNeeded) + content
    case "center": {
      const leftPad = Math.floor(paddingNeeded / 2)
      const rightPad = paddingNeeded - leftPad
      return " ".repeat(leftPad) + content + " ".repeat(rightPad)
    }
    default:
      return content + " ".repeat(paddingNeeded)
  }
}

function createSeparator(
  width: number,
  alignment: "left" | "center" | "right"
): string {
  switch (alignment) {
    case "center": {
      const dashCount = Math.max(1, width - 2)
      return `:${"-".repeat(dashCount)}:`
    }
    case "right": {
      const dashCount = Math.max(1, width - 1)
      return `${"-".repeat(dashCount)}:`
    }
    default:
      return "-".repeat(width)
  }
}

export function formatTable(table: ParsedTable): string {
  const { headers, alignments, rows } = table
  const columnCount = headers.length

  const columnWidths: number[] = []
  for (let col = 0; col < columnCount; col++) {
    let maxWidth = stringWidth(headers[col])

    for (const row of rows) {
      const cellContent = row[col] ?? ""
      const cellWidth = stringWidth(cellContent)
      if (cellWidth > maxWidth) {
        maxWidth = cellWidth
      }
    }

    columnWidths[col] = maxWidth
  }

  const formattedHeaders = headers.map((header, col) =>
    padCell(header, columnWidths[col], alignments[col] ?? "left")
  )
  const headerRow = `| ${formattedHeaders.join(" | ")} |`

  const separators = columnWidths.map((width, col) =>
    createSeparator(width, alignments[col] ?? "left")
  )
  const separatorRow = `| ${separators.join(" | ")} |`

  const formattedRows = rows.map((row) => {
    const formattedCells: string[] = []
    for (let col = 0; col < columnCount; col++) {
      const cell = row[col] ?? ""
      const width = columnWidths[col]
      const alignment = alignments[col] ?? "left"
      formattedCells.push(padCell(cell, width, alignment))
    }
    return `| ${formattedCells.join(" | ")} |`
  })

  return [headerRow, separatorRow, ...formattedRows].join("\n")
}

export function formatTablesInText(text: string, tables: ParsedTable[]): string {
  if (tables.length === 0) return text

  const sortedTables = [...tables].sort((a, b) => b.startIndex - a.startIndex)

  let result = text
  for (const table of sortedTables) {
    const formatted = formatTable(table)
    result =
      result.slice(0, table.startIndex) +
      formatted +
      result.slice(table.endIndex)
  }

  return result
}
