import { readFileSync } from "node:fs"

import { type Cell, catalogFor, cellId } from "./catalog.ts"
import { type CellResult, runFileSchema, SIGNAL_IDS, type SignalId } from "./vocabulary.ts"

interface Report {
  readonly os: string
  readonly session: string
  readonly cells: number
  readonly delivered: number
  readonly refused: number
  readonly failed: number
  readonly skipped: number
  readonly problems: readonly string[]
}

type Judgement =
  { readonly outcome: "delivered" | "refused" } | { readonly outcome: "failed" | "skipped"; readonly problem: string }

function changedSignals(result: CellResult, allowed: readonly SignalId[]): SignalId[] {
  return SIGNAL_IDS.filter((id) => result.journal[id].signal === "happened" && !allowed.includes(id))
}

function oracleProblem(cell: Cell, result: CellResult): string | undefined {
  if (result.oracle.observed === cell.oracle.equals) return undefined
  const { field, equals } = cell.oracle
  return `oracle ${field} == ${JSON.stringify(equals)} does not hold (fixture reads ${JSON.stringify(result.oracle.observed)})`
}

function inconsistentSignals(result: CellResult): SignalId[] {
  return SIGNAL_IDS.filter((id) => {
    const { signal, count, firstAt } = result.journal[id]
    return signal === "happened" ? count === 0 || firstAt === null : count !== 0 || firstAt !== null
  })
}

function cellProblem(cell: Cell, result: CellResult): string | undefined {
  const { observed } = result
  const inconsistent = inconsistentSignals(result)
  if (inconsistent.length > 0) return `observer journal contradicts itself: ${inconsistent.join(",")}`
  if (observed.kind === "error") return `error: ${observed.message}`
  if (observed.kind === "not_run") return undefined
  if ("deliver" in cell.expect) {
    if (observed.kind === "refused") return `expected deliver, observed refused ${observed.code}`
    const changed = changedSignals(result, cell.declares)
    return (
      oracleProblem(cell, result) ??
      (changed.length > 0 ? `observer journal not empty: ${changed.join(",")}` : undefined)
    )
  }
  const declared = cell.expect.refuse.join("|")
  if (observed.kind === "delivered") return `expected refused ${declared}, observed delivered`
  if (!cell.expect.refuse.some((code) => code === observed.code)) {
    return `expected refused ${declared}, observed refused ${observed.code}`
  }
  if (!observed.nothingSent) return "refused without nothingSent"
  const changed = changedSignals(result, [])
  return (
    oracleProblem(cell, result) ?? (changed.length > 0 ? `observer journal not empty: ${changed.join(",")}` : undefined)
  )
}

function judge(cell: Cell, id: string, result: CellResult): Judgement {
  if (result.observed.kind === "not_run") {
    return { outcome: "skipped", problem: `skipped cell ${id}: ${result.observed.reason}` }
  }
  const problem = cellProblem(cell, result)
  if (problem !== undefined) return { outcome: "failed", problem: `cell ${id}: ${problem}` }
  return { outcome: "deliver" in cell.expect ? "delivered" : "refused" }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

/** Judges one finished run against the catalog: every declared cell exactly once, each with its declared outcome. */
export function buildReport(catalog: readonly Cell[], results: readonly CellResult[]): Report {
  const problems: string[] = []
  const counts = { delivered: 0, refused: 0, failed: 0, skipped: 0 }
  const declared = groupBy(catalog, cellId)
  const observed = groupBy(results, (result) => result.id)
  if (catalog.length === 0) problems.push("empty catalog")
  for (const [id, cells] of declared) {
    const [cell] = cells
    const rows = observed.get(id) ?? []
    const [row] = rows
    const fault =
      cells.length > 1
        ? `contradictory cell ${id}: declared ${cells.length} times`
        : row === undefined
          ? `missing cell ${id}`
          : rows.length > 1
            ? `duplicate cell ${id}`
            : undefined
    if (fault !== undefined || cell === undefined || row === undefined) {
      problems.push(fault ?? `missing cell ${id}`)
      counts.failed += 1
      continue
    }
    const judgement = judge(cell, id, row)
    if ("problem" in judgement) problems.push(judgement.problem)
    counts[judgement.outcome] += 1
  }
  for (const id of observed.keys()) {
    if (declared.has(id)) continue
    problems.push(`undeclared cell ${id}`)
    counts.failed += 1
  }
  const [first] = catalog
  return { os: first?.os ?? "unknown", session: first?.session ?? "unknown", cells: declared.size, ...counts, problems }
}

export function summaryLine(report: Report): string {
  const { os, session, cells, delivered, refused, failed, skipped } = report
  return `CATALOG ${os}/${session} cells=${cells} delivered=${delivered} refused=${refused} failed=${failed} skipped=${skipped}`
}

function main(argv: readonly string[]): number {
  const at = argv.indexOf("--input")
  const input = at >= 0 ? argv[at + 1] : undefined
  if (input === undefined) {
    console.error("usage: report.ts --input <run.json>")
    return 2
  }
  const run = runFileSchema.parse(JSON.parse(readFileSync(input, "utf8")))
  const report = buildReport(catalogFor(run.os, run.session), run.results)
  for (const problem of report.problems) console.log(problem)
  console.log(summaryLine(report))
  return report.problems.length === 0 ? 0 : 1
}

if (import.meta.main) process.exit(main(process.argv.slice(2)))
