import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { reachableModules } from "./reachable"
import type { Row } from "./schema"

// Where one edition's command runs a different body from the core the root binds (design lane ruling, slice C1c,
// 2026-11-25). A gap is a fact about code, not about a row's state: the row can be resolved for one edition while
// another still runs its own function. So an entry names its evidence as data (the edition's entry module, the module
// holding the function it runs instead, and that function), and goes stale when that entry no longer reaches it.

export const EDITIONS = ["npm", "compiled"] as const

export type EditionGap = {
  readonly row: string
  readonly edition: string
  readonly reason: string
  readonly retires_with: string
  readonly evidence: { readonly entry: string; readonly module: string; readonly calls: string }
}

export const EDITION_GAPS: readonly EditionGap[] = (
  JSON.parse(readFileSync(join(import.meta.dir, "edition-gaps.json"), "utf8")) as { entries: EditionGap[] }
).entries

const callsFunction = (text: string, name: string): boolean =>
  new RegExp(`\\b${name.replace(/[^A-Za-z0-9_$]/g, "")}\\s*\\(`).test(text)

export function editionGapProblems(entries: readonly EditionGap[], rows: readonly Row[], repoRoot: string): string[] {
  const problems: string[] = []
  for (const entry of entries) {
    const at = `edition gap ${entry.row} (${entry.edition})`
    if (!rows.some((row) => row.id === entry.row)) problems.push(`${at}: no registry row ${entry.row}`)
    if (!(EDITIONS as readonly string[]).includes(entry.edition))
      problems.push(`${at}: ${entry.edition} is not an edition (${EDITIONS.join(", ")})`)
    const { entry: entryModule, module, calls } = entry.evidence
    const missing = [entryModule, module].filter((path) => !existsSync(join(repoRoot, path)))
    if (missing.length > 0) {
      problems.push(`${at}: its evidence names ${missing.join(" and ")}, which does not exist`)
      continue
    }
    if (!reachableModules(repoRoot, [entryModule]).includes(module))
      problems.push(`${at}: stale, ${entryModule} no longer reaches ${module}; delete the entry`)
    else if (!callsFunction(readFileSync(join(repoRoot, module), "utf8"), calls))
      problems.push(`${at}: stale, ${module} no longer calls ${calls}; delete the entry`)
  }
  return problems
}
