import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { reachableModules } from "./reachable"
import type { Row } from "./schema"

// Where one edition's command runs a different body from the core the root binds (design lane ruling, slice C1c,
// 2026-11-25). A gap is a fact about code, not about a row's state: the row can be resolved for one edition while
// another still runs its own function. So an entry names its evidence as data (the edition's entry module, the module
// holding the function it runs instead, and that function), and goes stale when that entry no longer reaches it.

// npm and compiled are the native package's two editions; opencode is the other product edition's command line.
const EDITIONS = ["npm", "compiled", "opencode"] as const

export const EDITION_GAPS_PATH = "script/sdk-parity/edition-gaps.json"

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

// One walk per entry module: the OpenCode command line's import graph is large, and every gap of an edition starts there.
const reached = new Map<string, ReadonlySet<string>>()
const reachedFrom = (repoRoot: string, entry: string): ReadonlySet<string> => {
  const key = `${repoRoot}\0${entry}`
  const known = reached.get(key)
  if (known !== undefined) return known
  const modules = new Set(reachableModules(repoRoot, [entry]))
  reached.set(key, modules)
  return modules
}

export function editionGapProblems(entries: readonly EditionGap[], rows: readonly Row[], repoRoot: string): string[] {
  const problems: string[] = []
  for (const entry of entries) {
    const at = `edition gap ${entry.row} (${entry.edition})`
    if (!rows.some((row) => row.id === entry.row)) problems.push(`${at}: no registry row ${entry.row}`)
    if (!(EDITIONS as readonly string[]).includes(entry.edition))
      problems.push(`${at}: ${entry.edition} is not an edition (${EDITIONS.join(", ")})`)
    const row = rows.find((candidate) => candidate.id === entry.row)
    if (entry.edition === "opencode" && row !== undefined) {
      if (!row.cli.some((cli) => cli.edition === "opencode"))
        problems.push(`${at}: ${entry.row} has no opencode command line, so that edition has nothing missing`)
      if (!row.slices.some((slice) => slice.startsWith("OC")))
        problems.push(`${at}: ${entry.row} carries no OC slice to build the opencode edition`)
    }
    const { entry: entryModule, module, calls } = entry.evidence
    const missing = [entryModule, module].filter((path) => !existsSync(join(repoRoot, path)))
    if (missing.length > 0) {
      problems.push(`${at}: its evidence names ${missing.join(" and ")}, which does not exist`)
      continue
    }
    if (!reachedFrom(repoRoot, entryModule).has(module))
      problems.push(`${at}: stale, ${entryModule} no longer reaches ${module}; delete the entry`)
    else if (!callsFunction(readFileSync(join(repoRoot, module), "utf8"), calls))
      problems.push(`${at}: stale, ${module} no longer calls ${calls}; delete the entry`)
  }
  return problems
}

/**
 * An edition gap is added only by the pull request that clears its row's unresolved entry (design lane ruling): a gap
 * the merge base did not have, on a row the merge base did not hold unresolved, could hide a regression in a built row.
 */
export function editionGapAdditionProblems(
  head: readonly EditionGap[],
  baseGaps: readonly EditionGap[],
  baseUnresolved: ReadonlySet<string>,
): string[] {
  const had = new Set(baseGaps.map((gap) => `${gap.row} ${gap.edition}`))
  return head
    .filter((gap) => !had.has(`${gap.row} ${gap.edition}`) && !baseUnresolved.has(gap.row))
    .map(
      (gap) =>
        `edition gap ${gap.row} (${gap.edition}): ${gap.row} was not unresolved at the merge base; an edition gap is added only by the pull request that clears its row`,
    )
}
