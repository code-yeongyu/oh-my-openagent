import type { DomainFile, Row, TableEntry } from "./schema"
import { SLICES } from "./schema"

// Review M3: section 6 is rendered from the table entries, so each published cell is tied to its rows' structured fields
// here. A registry edit (a route, a tool, today, a slice, a planned surface) that the cell does not show fails, and the
// cell edit it forces makes the rendering differ from the design, which the byte comparison then reports.

const PLACEHOLDER = /^\{\{rows ([0-9a-z.-]+)\}\}$/

export function tableHeaders(template: string): Map<string, readonly string[]> {
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

// Cells that name a group of flags in words instead of listing them (review M7): exact both ways, so a flag the group
// gains or loses fails until this list and the published cell agree.
export const CELL_ABBREVIATIONS: Readonly<
  Record<string, { readonly flags: readonly string[]; readonly reason: string }>
> = {
  "6.11#1": {
    flags: [
      "--claude",
      "--openai",
      "--gemini",
      "--copilot",
      "--opencode-zen",
      "--zai-coding-plan",
      "--kimi-for-coding",
      "--opencode-go",
      "--bailian-coding-plan",
      "--minimax-cn-coding-plan",
      "--minimax-coding-plan",
      "--vercel-ai-gateway",
    ],
    reason: "the cell says one flag per provider input and enumerates InstallArgs' twelve keys mechanically",
  },
  "6.11-loop#8": {
    flags: [
      "--source",
      "--goal-id",
      "--goal",
      "--criterion-id",
      "--scenario",
      "--expected-evidence",
      "--user-model",
      "--title",
      "--objective",
      "--children",
      "--replacements",
      "--order",
      "--idempotency-key",
    ],
    reason: "the cell says with the flags each of the seven kinds requires (cli-steering.ts:84-90)",
  },
}

// Flags a cell names only as a usage refusal (`omo update --all` is refused, `--force` alone is refused): not mappings.
export const CELL_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  "6.8#4": ["--all"],
  "6.7#15": ["--all", "--force"],
}

const SIGNATURE_FIELDS = /`[a-zA-Z.]+\(\{([^`]*)\}\)/g
const topFields = (signature: string): string[] => {
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const char of signature) {
    if ("{[(".includes(char)) depth++
    if ("}])".includes(char)) depth--
    if (char === "," && depth === 0) {
      out.push(current)
      current = ""
    } else current += char
  }
  out.push(current)
  return out
    .map((field) => /^\s*([a-z_][a-zA-Z_]*)\??\s*(?::|$)/.exec(field)?.[1])
    .filter((name): name is string => name !== undefined)
}

// Review M7: the published cells against the rows' mappings, both ways for flags, cell to row for input fields, and the
// rows' omission reasons against the cell that publishes them.
export function mappingProblems(template: string, files: readonly DomainFile[]): string[] {
  const byId = new Map(files.flatMap((file) => file.rows).map((row) => [row.id, row]))
  const problems: string[] = []
  const usedAbbreviations = new Set<string>()
  for (const entry of files.flatMap((file) => file.tables)) {
    if (entry.kind === "pointer") continue
    const key = `${entry.table}#${entry.position}`
    const opencode = entry.table.startsWith("6.11")
    const rows = entry.ids.map((id) => byId.get(id)).filter((row): row is Row => row !== undefined)
    const text = plain(entry.cells.join(" | "))
    const mapped = rows.flatMap((row) => row.cli.filter((cli) => (cli.edition === "opencode") === opencode))
    const mappedFlags = new Set(mapped.flatMap((cli) => Object.keys(cli.flags)))
    const anyEdition = new Set(rows.flatMap((row) => row.cli.flatMap((cli) => Object.keys(cli.flags))))
    const abbreviated = CELL_ABBREVIATIONS[key]
    const refused = CELL_REFUSALS[key] ?? []
    for (const flag of new Set(text.match(/(?<![\w-])--[a-z][a-z0-9-]*/g) ?? [])) {
      if (entry.table === "6.9" || anyEdition.has(flag)) continue
      if (refused.includes(flag)) usedAbbreviations.add(`${key} refusal ${flag}`)
      else if (rows.some((row) => row.cli.length > 0))
        problems.push(`${key}: the cell shows ${flag}, which no entry of its rows maps`)
    }
    for (const flag of mappedFlags) {
      const target = mapped.find((cli) => Object.hasOwn(cli.flags, flag))?.flags[flag]
      if (target === "render" || text.includes(flag) || template.includes(`\`${flag}`)) continue
      if (abbreviated?.flags.includes(flag) === true) {
        usedAbbreviations.add(`${key} ${flag}`)
        continue
      }
      problems.push(
        `${key}: ${rows.map((row) => row.id).join(", ")} maps ${flag}, which the published cell does not show`,
      )
    }
    for (const match of plain(entry.cells[0] ?? "").matchAll(SIGNATURE_FIELDS))
      for (const field of topFields(match[1] ?? ""))
        if (!rows.some((row) => Object.hasOwn(row.input.properties, field)))
          problems.push(`${key}: the cell's signature names ${field}, which no row of it takes`)
    // 6.11's tables have no tool column, so a tool omission is published only in the native tables.
    for (const row of opencode ? [] : rows)
      for (const reason of [row.omitted.cli, row.omitted.tool]) {
        if (reason === undefined || reason.startsWith("CLI omitted: ")) continue
        const borrowed = / \(as for [^)]*\)$/.test(reason)
        const own = reason.replace(/ \(as for [^)]*\)$/, "")
        const published = text.includes(own.slice(0, 40)) || (borrowed && /\bSame reason\b/.test(text))
        if (!published)
          problems.push(`${key}: ${row.id}'s omission reason "${own.slice(0, 40)}..." is not the published one`)
      }
  }
  for (const [key, flags] of Object.entries(CELL_REFUSALS))
    for (const flag of flags)
      if (!usedAbbreviations.has(`${key} refusal ${flag}`))
        problems.push(`CELL_REFUSALS ${key} lists ${flag}, which the cell does not name; remove it`)
  for (const [key, abbreviation] of Object.entries(CELL_ABBREVIATIONS))
    for (const flag of abbreviation.flags)
      if (!usedAbbreviations.has(`${key} ${flag}`))
        problems.push(`CELL_ABBREVIATIONS ${key} lists ${flag}, which no row maps there; remove it`)
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
