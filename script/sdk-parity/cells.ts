import type { DomainFile, Row, TableEntry } from "./schema"
import { SLICES } from "./schema"

// Review M3: section 6 is rendered from the table entries, so each published cell is tied to its rows' structured fields
// here. A registry edit (a route, a tool, today, a slice, a planned surface) that the cell does not show fails, and the
// cell edit it forces makes the rendering differ from the design, which the byte comparison then reports.

const PLACEHOLDER = /^\{\{rows ([0-9a-z.-]+)\}\}$/

function tableHeaders(template: string): Map<string, readonly string[]> {
  const lines = template.split("\n")
  const out = new Map<string, readonly string[]>()
  lines.forEach((line, index) => {
    const match = PLACEHOLDER.exec(line)
    const header = lines[index - 2]
    if (match?.[1] !== undefined && header !== undefined)
      out.set(
        match[1],
        header
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )
  })
  return out
}

const plain = (cell: string): string => cell.replace(/\\\|/g, "|").replace(/\*\*/g, "")
const todayOf = (cell: string): string | undefined => /^(yes|partial|no)\b/.exec(plain(cell).trim())?.[1]
const slicesIn = (cell: string): Set<string> =>
  new Set(
    plain(cell)
      .split(/[\s,;()]+/)
      .filter((word) => SLICES.has(word) && word !== "shipped" && word !== "reserved"),
  )

// Pointer entries (6.8's Host sessions, 6.11's account and loop rows) name rows described in another table: only their
// CLI routes are checked, each against the rows they point at.
function pointerProblems(entry: TableEntry, headers: readonly string[], rows: readonly Row[]): string[] {
  const index = headers.findIndex((header) => /^CLI/.test(header))
  const routes = rows.flatMap((row) => row.cli.map((cli) => cli.route.join(" ")))
  const shown = (plain(entry.cells[index] ?? "").match(/`(?:omo )?([a-z][a-z -|]*)/g) ?? []).map((span) =>
    span
      .replace(/^`(?:omo )?/, "")
      .split(" ")
      .filter((word) => /^[a-z]/.test(word) && !word.startsWith("-")),
  )
  const problems: string[] = []
  for (const words of shown) {
    const expanded = words.map((word) => word.split("|"))
    const ok =
      expanded.length === 0 || (expanded[0] ?? []).some((head) => routes.some((route) => route.startsWith(head)))
    if (!ok)
      problems.push(
        `table ${entry.table} row ${entry.position}: the pointer cell shows "${words.join(" ")}", which none of its rows carries`,
      )
  }
  return problems
}

function entryProblems(
  entry: TableEntry,
  headers: readonly string[],
  rows: readonly Row[],
  previousToday: string | undefined,
): string[] {
  if (entry.kind === "pointer") return pointerProblems(entry, headers, rows)
  const opencodeTable = entry.table.startsWith("6.11")
  const problems: string[] = []
  const cell = (name: RegExp): string | undefined => {
    const index = headers.findIndex((header) => name.test(header))
    return index < 0 ? undefined : entry.cells[index]
  }
  const at = `table ${entry.table} row ${entry.position}`
  const first = cell(/^Root call$/) ?? entry.cells[0] ?? ""
  for (const row of rows)
    if (
      row.kind === "capability" &&
      !plain(first).includes(`${row.sdk.split(".").at(-1)}(`) &&
      !plain(first).includes(row.sdk)
    )
      problems.push(`${at}: the capability cell does not name ${row.sdk}`)
  const cli = cell(/^(CLI|Sub-command)/)
  if (cli !== undefined) {
    const text = ` ${plain(cli)
      .replace(/[`[\]<>]/g, " ")
      .replace(/\|/g, " ")} `
    for (const row of rows)
      for (const entryCli of row.cli.filter((e) => (e.edition === "opencode") === opencodeTable)) {
        // The loop table lists sub-commands without the `ulw-loop` word that reaches them.
        const words = entry.table.endsWith("-loop")
          ? entryCli.route.filter((word) => word !== "ulw-loop")
          : entryCli.route
        if (words.length > 0 && !words.every((word) => text.includes(` ${word} `)))
          problems.push(`${at}: ${row.id} has route "${entryCli.route.join(" ")}", which the CLI cell does not show`)
      }
  }
  const tool = cell(/^Tool$/)
  if (tool !== undefined) {
    const named = new Set(/^none\b/.test(plain(tool).trim()) ? [] : (plain(tool).match(/\bthread_[a-z_]+/g) ?? []))
    const fromRows = new Set(
      rows.flatMap((row) => row.tool.map((t) => t.name)).filter((name) => name.startsWith("thread_")),
    )
    for (const name of fromRows)
      if (!named.has(name)) problems.push(`${at}: a row names tool ${name}, which the Tool cell does not`)
    for (const name of named)
      if (!fromRows.has(name)) problems.push(`${at}: the Tool cell names ${name}, which no row of it maps`)
  }
  const today = cell(/^SDK today$/)
  if (today !== undefined)
    for (const row of rows)
      if (
        row.kind === "capability" &&
        (todayOf(today) ?? (/^same\b/.test(today) ? previousToday : undefined)) !== row.today
      )
        problems.push(`${at}: ${row.id} is "${row.today}" today, the cell says "${todayOf(today) ?? today}"`)
  const slice = cell(/^Slice$/)
  if (slice !== undefined) {
    const shown = slicesIn(slice)
    const fromRows = new Set(
      rows
        .flatMap((row) => row.slices)
        .filter((name) => name !== "shipped" && name !== "reserved" && opencodeTable === name.startsWith("OC")),
    )
    for (const name of fromRows)
      if (!shown.has(name)) problems.push(`${at}: a row's slice ${name} is not in the Slice cell`)
    const allSlices = new Set(rows.flatMap((row) => row.slices))
    for (const name of shown)
      if (!allSlices.has(name)) problems.push(`${at}: the Slice cell names ${name}, which no row of it carries`)
  }
  const adapter = cell(/^Adapter$/)
  if (adapter !== undefined)
    for (const row of rows)
      for (const planned of [row.planned.cli, row.planned.tool])
        if (planned !== undefined && !plain(adapter).includes(planned) && !plain(slice ?? "").includes(planned))
          problems.push(`${at}: ${row.id} plans a surface in ${planned}, which the Adapter cell does not say`)
  return problems
}

export function cellProblems(template: string, files: readonly DomainFile[]): string[] {
  const headers = tableHeaders(template)
  const byId = new Map(files.flatMap((file) => file.rows).map((row) => [row.id, row]))
  const entries = files
    .flatMap((file) => file.tables)
    .toSorted((a, b) => a.table.localeCompare(b.table) || a.position - b.position)
  const problems: string[] = []
  let previous: { readonly table: string; readonly today: string | undefined } | undefined
  for (const entry of entries) {
    const header = headers.get(entry.table) ?? []
    const rows = entry.ids.map((id) => byId.get(id)).filter((row): row is Row => row !== undefined)
    const inherited = previous?.table === entry.table ? previous.today : undefined
    problems.push(...entryProblems(entry, header, rows, inherited))
    const todayCell = entry.cells[header.indexOf("SDK today")] ?? ""
    previous = { table: entry.table, today: todayOf(todayCell) ?? inherited }
  }
  return problems
}
