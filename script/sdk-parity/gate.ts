import { type BaselineEntry, sha256 } from "./baseline"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { Row } from "./schema"
import { schemaDifferences, type DiscoveredTool } from "./tool-check"

// The changed-capability gate of design 7.4 (amendments 2 and 3). A demonstrated change fails it: a descriptor or tool-schema
// change, or a base-versus-head outcome difference, under an unresolved entry, and a security-gated entry cleared without
// its slice. A candidate, where only a closure moved with every outcome equal, is a merge requirement a reviewer carries:
// the gate prints the candidates and their digest at the head, and verify-review.ts holds the verdict to that digest.

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
  readonly headSha: string
}

export type GateReport = {
  readonly failures: readonly string[]
  readonly candidates: readonly string[]
  readonly head: string
  readonly digest: string
  readonly unchangedLine: boolean
  readonly initialization: boolean
}

const UNCHANGED_LINE = /^SDK-Parity-Unchanged:\s*yes\s*$/im
const SLICE_LINE = /^SDK-Parity-Slice:\s*(\S+)\s*$/gim

const descriptor = (row: Row): string => JSON.stringify(row)

// Design 7.4 (amendment 3): the candidates' digest binds the head and the sorted ids, so a verdict from another head or
// over another list cannot carry it. The reviewer copies it into `SDK-Parity-Reviewed: <digest>`; nobody types the ids.
export function candidateDigest(head: string, ids: readonly string[]): string {
  return sha256(`sdk-parity-candidates v1\n${head}\n${[...ids].toSorted().join("\n")}`).slice(0, 24)
}

export const CANDIDATES_LINE =
  /^SDK-Parity-Candidates: head=([0-9a-f]{40}) digest=([0-9a-f]{24}) count=(\d+) ids=(.*)$/m

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
      failures.push(
        `${row.id}: its descriptor changed under an unresolved gap; add the SDK call ${row.sdk} and its scenarios in this pull request`,
      )
      flagged.add(row.id)
    }
    for (const entry of row.tool) {
      const [a, b] = [input.base.tools, input.head.tools].map(
        (tools) => tools.find((tool) => tool.name === entry.name)?.parameters,
      )
      const moved = a !== undefined && b !== undefined ? schemaDifferences(a, b, entry.name) : []
      if (moved.length > 0) {
        failures.push(
          `${row.id}: tool ${entry.name} changed its input schema under an unresolved gap (${moved[0]}); add the SDK call ${row.sdk}`,
        )
        flagged.add(row.id)
      }
    }
  }
  for (const scenario of input.scenarios) {
    const [before, after] = [input.base.outcomes[scenario.id], input.head.outcomes[scenario.id]]
    if (after === undefined) {
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} has no outcome at the head; the runner did not run it`,
      )
      continue
    }
    // A scenario the merge base's tree has no outcome for is new in this pull request; it has nothing to compare against.
    if (before === undefined || JSON.stringify(before) === JSON.stringify(after)) continue
    if (unresolved.has(scenario.capability) || !baseRows.has(scenario.capability) || initialization) {
      failures.push(
        `${scenario.capability}: scenario ${scenario.id} answers differently on the merge base and the head; this pull request changes what it does without the SDK call ${scenario.capability}`,
      )
      flagged.add(scenario.capability)
    }
  }
  const slices = new Set([...input.body.matchAll(SLICE_LINE)].map((match) => match[1]))
  const atHead = unresolved
  for (const entry of input.base.unresolved ?? [])
    if (!atHead.has(entry.id) && entry.clearedOnlyBy !== undefined && !slices.has(entry.clearedOnlyBy))
      failures.push(
        `${entry.id}: only slice ${entry.clearedOnlyBy} clears this gap; name it with an "SDK-Parity-Slice: ${entry.clearedOnlyBy}" line or keep the entry`,
      )
  const changed = new Set(input.changedFiles)
  const candidates = [...input.closures]
    .filter(([id, files]) => unresolved.has(id) && !flagged.has(id) && [...files].some((file) => changed.has(file)))
    .map(([id]) => id)
    .toSorted()
  return {
    failures,
    candidates,
    head: input.headSha,
    digest: candidateDigest(input.headSha, candidates),
    unchangedLine: UNCHANGED_LINE.test(input.body),
    initialization,
  }
}

// The committed goldens are the reviewer's view of the comparison (design 7.4); the gate never reads them as truth, and
// they must equal the head's live outcomes, so an edited golden with unchanged behaviour fails here.
export function goldenProblems(
  committed: Readonly<Record<string, Outcome>>,
  live: Readonly<Record<string, Outcome>>,
): string[] {
  const ids = new Set([...Object.keys(committed), ...Object.keys(live)])
  return [...ids]
    .toSorted()
    .filter((id) => JSON.stringify(committed[id]) !== JSON.stringify(live[id]))
    .map(
      (id) =>
        `goldens.json ${id} differs from the scenario's live outcome; regenerate with bun script/sdk-parity/scenario-run.ts --out script/sdk-parity/goldens.json`,
    )
}

export function renderReport(report: GateReport): string {
  const lines = [
    `## SDK parity gate${report.initialization ? " (initialization: the merge base has no registry)" : ""}`,
    "",
  ]
  if (report.failures.length === 0) lines.push("No failure.")
  else lines.push(`${report.failures.length} failure(s):`, "", ...report.failures.map((failure) => `- ${failure}`))
  lines.push("")
  lines.push(
    `SDK-Parity-Candidates: head=${report.head} digest=${report.digest} count=${report.candidates.length} ids=${report.candidates.join(",")}`,
    "",
  )
  if (report.candidates.length === 0) lines.push("No unresolved capability is a candidate: no closure moved.")
  else
    lines.push(
      `${report.candidates.length} candidate(s): unresolved capabilities whose closure moved with every outcome equal. A merge requirement: the body carries \`SDK-Parity-Unchanged: yes\` and the reviewer's verdict at this head carries \`SDK-Parity-Reviewed: ${report.digest}\`.`,
      "",
      report.candidates.join(", "),
      "",
      report.unchangedLine
        ? "The body carries `SDK-Parity-Unchanged: yes`."
        : "MISSING: the body needs the line `SDK-Parity-Unchanged: yes`.",
    )
  return `${lines.join("\n")}\n`
}
