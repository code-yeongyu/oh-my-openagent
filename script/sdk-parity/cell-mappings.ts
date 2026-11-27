import type { DomainFile, Row } from "./schema"

const plain = (cell: string): string => cell.replace(/\\\|/g, "|").replace(/\*\*/g, "")

// Cells that name a group of flags in words instead of listing them (review M7): exact both ways, so a flag the group
// gains or loses fails until this list and the published cell agree.
const CELL_ABBREVIATIONS: Readonly<Record<string, { readonly flags: readonly string[]; readonly reason: string }>> = {
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
const CELL_REFUSALS: Readonly<Record<string, readonly string[]>> = {
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
