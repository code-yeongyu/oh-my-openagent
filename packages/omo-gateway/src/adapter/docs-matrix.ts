// Reads the platform matrix in docs/adapters.md, so every adapter's docs-matrix.test.ts can compare
// its documented row with the Capabilities object the adapter really reports.
import { readFileSync } from "node:fs"
import { join } from "node:path"

export const ADAPTERS_DOC = join(import.meta.dir, "..", "..", "docs", "adapters.md")

const HEADING = "### Platform matrix"

export type PlatformMatrix = { columns: readonly string[]; rows: ReadonlyMap<string, readonly string[]> }

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())

/** The table under `### Platform matrix`: capability columns and the cells of each row by its first column. */
export function readPlatformMatrix(path: string = ADAPTERS_DOC): PlatformMatrix {
  const lines = readFileSync(path, "utf8").split("\n")
  const start = lines.findIndex((line) => line.trim() === HEADING)
  if (start < 0) throw new Error(`${path} has no "${HEADING}" section`)
  const table: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("|")) table.push(line)
    else if (table.length > 0) break
  }
  const [header, , ...body] = table
  if (header === undefined) throw new Error(`the ${HEADING} section of ${path} has no table`)
  const columns = cellsOf(header).slice(1)
  const rows = new Map<string, readonly string[]>()
  for (const line of body) {
    const [label = "", ...cells] = cellsOf(line)
    if (cells.length !== columns.length) throw new Error(`matrix row "${label}" has ${cells.length} cells for ${columns.length} columns`)
    rows.set(label, cells)
  }
  return { columns, rows }
}

function cellValue(column: string, cell: string): boolean | number {
  if (column === "max_text") {
    const value = Number(cell)
    if (!Number.isSafeInteger(value)) throw new Error(`max_text cell "${cell}" is not a number`)
    return value
  }
  if (/^yes\b/.test(cell)) return true
  if (/^no\b/.test(cell)) return false
  throw new Error(`${column} cell "${cell}" starts with neither yes nor no`)
}

/** One documented row as the capability object it claims (`yes`/`no` first, notes after). */
export function documentedCapabilities(label: string, matrix: PlatformMatrix = readPlatformMatrix()): Record<string, boolean | number> {
  const cells = matrix.rows.get(label)
  if (cells === undefined) throw new Error(`the platform matrix has no row "${label}" (rows: ${[...matrix.rows.keys()].join(", ")})`)
  return Object.fromEntries(matrix.columns.map((column, index) => [column, cellValue(column, cells[index] ?? "")]))
}
