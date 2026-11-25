import type { BaselineEntry } from "./baseline"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"
import { schemaDifferences, type DiscoveredTool } from "./tool-check"

// The changed-capability gate of design 7.4 with the design lane's rulings for P0 (amendment 2). It fails on a descriptor
// or tool-schema change under an unresolved entry, on any base-versus-head outcome difference under an unresolved entry,
// and on a security-gated entry cleared without its slice. A closure-only change with equal outcomes never fails: the
// gate reports the touched capabilities and whether the PR body carries `SDK-Parity-Unchanged: yes`.

export type Side = {
  readonly rows: readonly Row[] | undefined
  readonly tools: readonly DiscoveredTool[]
  readonly outcomes: Readonly<Record<string, Outcome>>
  readonly unresolved: readonly BaselineEntry[] | undefined
}

export type GateInput = {
  readonly base: Side
  readonly head: Side & { readonly rows: readonly Row[]; readonly unresolved: readonly BaselineEntry[] }
  readonly scenarios: readonly Scenario[]
  readonly closures: ReadonlyMap<string, ReadonlySet<string>>
  readonly changedFiles: readonly string[]
  readonly body: string
}

export type GateReport = {
  readonly failures: readonly string[]
  readonly closureOnly: readonly string[]
  readonly unchangedLine: boolean
  readonly initialization: boolean
}

const UNCHANGED_LINE = /^SDK-Parity-Unchanged:\s*yes\s*$/im
const SLICE_LINE = /^SDK-Parity-Slice:\s*(\S+)\s*$/gim

const descriptor = (row: Row): string => JSON.stringify(row)

export function gateReport(input: GateInput): GateReport {
  const failures: string[] = []
  const unresolved = new Set(input.head.unresolved.map((entry) => entry.id))
  const initialization = input.base.rows === undefined
  const baseRows = new Map((input.base.rows ?? []).map((row) => [row.id, row]))
  const flagged = new Set<string>()
  for (const row of input.head.rows) {
    if (!unresolved.has(row.id)) continue
    const before = baseRows.get(row.id)
    if (!initialization && (before === undefined || descriptor(before) !== descriptor(row))) {
      failures.push(`${row.id}: its descriptor changed under an unresolved gap; add the SDK call ${row.sdk} and its scenarios in this pull request`)
      flagged.add(row.id)
    }
    for (const entry of row.tool) {
      const [a, b] = [input.base.tools, input.head.tools].map((tools) => tools.find((tool) => tool.name === entry.name)?.parameters)
      const moved = a !== undefined && b !== undefined ? schemaDifferences(a, b, entry.name) : []
      if (moved.length > 0) {
        failures.push(`${row.id}: tool ${entry.name} changed its input schema under an unresolved gap (${moved[0]}); add the SDK call ${row.sdk}`)
        flagged.add(row.id)
      }
    }
  }
  for (const scenario of input.scenarios) {
    const [before, after] = [input.base.outcomes[scenario.id], input.head.outcomes[scenario.id]]
    if (before === undefined || after === undefined || JSON.stringify(before) === JSON.stringify(after)) continue
    if (unresolved.has(scenario.capability) || !baseRows.has(scenario.capability) || initialization) {
      failures.push(`${scenario.capability}: scenario ${scenario.id} answers differently on the merge base and the head; this pull request changes what it does without the SDK call ${scenario.capability}`)
      flagged.add(scenario.capability)
    }
  }
  const slices = new Set([...input.body.matchAll(SLICE_LINE)].map((match) => match[1]))
  const atHead = unresolved
  for (const entry of input.base.unresolved ?? [])
    if (!atHead.has(entry.id) && entry.clearedOnlyBy !== undefined && !slices.has(entry.clearedOnlyBy))
      failures.push(`${entry.id}: only slice ${entry.clearedOnlyBy} clears this gap; name it with an "SDK-Parity-Slice: ${entry.clearedOnlyBy}" line or keep the entry`)
  const changed = new Set(input.changedFiles)
  const closureOnly = [...input.closures]
    .filter(([id, files]) => unresolved.has(id) && !flagged.has(id) && [...files].some((file) => changed.has(file)))
    .map(([id]) => id)
    .toSorted()
  return { failures, closureOnly, unchangedLine: UNCHANGED_LINE.test(input.body), initialization }
}

export function renderReport(report: GateReport): string {
  const lines = [`## SDK parity gate${report.initialization ? " (initialization: the merge base has no registry)" : ""}`, ""]
  if (report.failures.length === 0) lines.push("No failure.")
  else lines.push(`${report.failures.length} failure(s):`, "", ...report.failures.map((failure) => `- ${failure}`))
  lines.push("")
  if (report.closureOnly.length === 0) lines.push("No unresolved capability's closure moved.")
  else {
    lines.push(
      `${report.closureOnly.length} unresolved capabilities whose closure this pull request touches, with equal outcomes:`,
      "",
      report.closureOnly.join(", "),
      "",
      report.unchangedLine
        ? "The body carries `SDK-Parity-Unchanged: yes`; the reviewer checks it against this list and the diff."
        : "MISSING: the body needs the line `SDK-Parity-Unchanged: yes` (a report, not a failure); the reviewer checks it against this list and the diff.",
    )
  }
  return `${lines.join("\n")}\n`
}
