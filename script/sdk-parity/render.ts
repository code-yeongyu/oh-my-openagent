import type { DomainFile, TableEntry } from "./schema"

// Section 6 of the design is rendered from the rows (design 7.2): the template holds the prose, the table headers and
// the two tables that are not capabilities; each `{{rows <table>}}` line becomes that table's rows, in position order.

const PLACEHOLDER = /^\{\{rows ([0-9a-z.-]+)\}\}$/

const SECTION_START = "## 6. Parity table"
const SECTION_END = "## 7. "

export function section6Of(doc: string): string {
  const start = doc.indexOf(`\n${SECTION_START}`)
  const end = doc.indexOf(`\n${SECTION_END}`)
  if (start < 0 || end < start) throw new Error(`the design has no "${SECTION_START}" section before "${SECTION_END}"`)
  return doc.slice(start + 1, end + 1)
}

const renderEntry = (entry: TableEntry): string => `| ${entry.cells.join(" | ")} |`

export function renderSection6(template: string, files: readonly DomainFile[]): string {
  const byTable = new Map<string, TableEntry[]>()
  for (const entry of files.flatMap((file) => file.tables))
    byTable.set(entry.table, [...(byTable.get(entry.table) ?? []), entry])
  const used = new Set<string>()
  const lines = template.split("\n").flatMap((line) => {
    const match = PLACEHOLDER.exec(line)
    if (match === null) return [line]
    const table = match[1] ?? ""
    if (used.has(table)) throw new Error(`the template places table ${table} twice`)
    used.add(table)
    const entries = (byTable.get(table) ?? []).toSorted((a, b) => a.position - b.position)
    if (entries.length === 0) throw new Error(`the template places table ${table}, which no row renders`)
    return entries.map(renderEntry)
  })
  const unplaced = [...byTable.keys()].filter((table) => !used.has(table))
  if (unplaced.length > 0) throw new Error(`rows render into tables the template never places: ${unplaced.join(", ")}`)
  return lines.join("\n")
}

export function firstDifferences(rendered: string, committed: string, limit = 5): string[] {
  const a = rendered.split("\n")
  const b = committed.split("\n")
  const out: string[] = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < limit; i++)
    if (a[i] !== b[i]) out.push(`line ${i + 1}\n  rendered: ${a[i] ?? "<none>"}\n  design:   ${b[i] ?? "<none>"}`)
  return out
}
