import { readFileSync } from "node:fs"
import { join } from "node:path"

import { REPO_ROOT } from "./registry"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"

// Design 7.4 (presentation attribution): a CLI scenario that declares its usage block (`usage` in scenarios.ts) may
// answer differently on the merge base and the head without its SDK call only when the difference is the usage text of
// an existing verb and nothing else: the exit code is equal, each stream is equal or carries the block on both sides,
// every line outside the block is equal, the block lists the same verbs in the same layout, every changed block line is
// named, before and after, by a row of presentation.json that names the verb and the reason, and the pull request's
// goldens for the scenario carry the new outcome. Anything else stays a capability change and fails the gate.

export type PresentationRow = {
  readonly verb: string
  readonly scenarios: readonly string[]
  readonly changes: readonly { readonly before: string; readonly after: string }[]
  readonly reason: string
}

const PRESENTATION_PATH = "script/sdk-parity/presentation.json"

export const parsePresentation = (text: string): readonly PresentationRow[] =>
  (JSON.parse(text) as { readonly rows: readonly PresentationRow[] }).rows

export const loadPresentation = (root: string = REPO_ROOT): readonly PresentationRow[] =>
  parsePresentation(readFileSync(join(root, PRESENTATION_PATH), "utf8"))

export type Goldens = {
  readonly base: Readonly<Record<string, Outcome>> | undefined
  readonly head: Readonly<Record<string, Outcome>>
}

const STREAMS = ["stdout", "stderr"] as const
const indentOf = (line: string): number => line.length - line.trimStart().length

type Block = { readonly start: number; readonly end: number; readonly verbs: readonly string[] }

// The block is the lines after the `usage: omo <command>` header that start with white space. A line at the first
// line's indent opens a verb's entry (its first word); a deeper line continues the entry above it.
function usageBlock(lines: readonly string[], command: string): Block | undefined {
  const header = `usage: omo ${command}`
  const at = lines.findIndex((line) => line === header || line.startsWith(`${header} `))
  if (at < 0) return undefined
  let end = at + 1
  while (end < lines.length && /^\s+\S/.test(lines[end] ?? "")) end += 1
  const body = lines.slice(at + 1, end)
  const entryIndent = indentOf(body[0] ?? "")
  let verb = ""
  const verbs = body.map((line) => {
    if (indentOf(line) === entryIndent) {
      verb = line.trim().split(/\s+/)[0] ?? ""
      return `entry ${verb}`
    }
    return `more ${verb}`
  })
  return { start: at + 1, end, verbs }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// A row owns the scenarios it names: each must exist and declare a usage block, and one verb of one scenario is named by
// at most one row, so which row cleared a line is never ambiguous. Rows for different verbs of one scenario coexist.
export function presentationRowProblems(rows: readonly PresentationRow[], scenarios: readonly Scenario[]): string[] {
  const problems: string[] = []
  const claimed = new Set<string>()
  for (const row of rows) {
    if (row.changes.length === 0) problems.push(`${PRESENTATION_PATH}: the row for ${row.verb} names no changed line`)
    for (const id of row.scenarios) {
      const scenario = scenarios.find((candidate) => candidate.id === id)
      if (scenario === undefined)
        problems.push(`${PRESENTATION_PATH}: the row for ${row.verb} names scenario ${id}, which does not exist`)
      else if (!("usage" in scenario) || scenario.usage === undefined)
        problems.push(
          `${PRESENTATION_PATH}: the row for ${row.verb} names scenario ${id}, which declares no usage block`,
        )
      const key = `${id} ${row.verb}`
      if (claimed.has(key)) problems.push(`${PRESENTATION_PATH}: scenario ${id} has two rows for ${row.verb}`)
      claimed.add(key)
    }
  }
  return problems
}

export function presentationProblems(
  scenario: Scenario,
  before: Outcome,
  after: Outcome,
  rows: readonly PresentationRow[],
  goldens: Goldens,
  matched: Set<string> = new Set(),
): string[] {
  if (
    scenario.surface === "tool" ||
    scenario.surface === "loop-parse" ||
    scenario.surface === "sdk" ||
    scenario.usage === undefined
  )
    return ["the scenario declares no usage block"]
  const command = scenario.usage
  const keys = (outcome: Outcome) => Object.keys(outcome).toSorted().join(",")
  if (keys(before) !== "exit,stderr,stdout" || keys(after) !== "exit,stderr,stdout")
    return ["the outcome is not an exit code with its two streams"]
  const typed = (outcome: Outcome) =>
    typeof outcome["exit"] === "number" && STREAMS.every((stream) => typeof outcome[stream] === "string")
  if (!typed(before) || !typed(after)) return ["the outcome's fields are not a numeric exit code and two text streams"]
  if (before["exit"] !== after["exit"]) return [`the exit code changed (${before["exit"]} -> ${after["exit"]})`]
  const named = rows.filter((row) => row.scenarios.includes(scenario.id))
  if (named.length === 0) return [`no row of ${PRESENTATION_PATH} names scenario ${scenario.id}`]
  const problems: string[] = []
  for (const row of named) {
    if (row.reason.trim() === "") problems.push(`the row for ${row.verb} gives no reason`)
    if (!row.verb.startsWith(`${command} `)) problems.push(`the row names ${row.verb}, not a verb of omo ${command}`)
  }
  for (const stream of STREAMS) {
    const [a, b] = [`${before[stream]}`, `${after[stream]}`]
    if (a === b) continue
    const [linesA, linesB] = [a.split("\n"), b.split("\n")]
    const [blockA, blockB] = [usageBlock(linesA, command), usageBlock(linesB, command)]
    if (blockA === undefined || blockB === undefined) {
      problems.push(`${stream} changed and does not carry the usage block of omo ${command} on both sides`)
      continue
    }
    if (
      !same(linesA.slice(0, blockA.start), linesB.slice(0, blockB.start)) ||
      !same(linesA.slice(blockA.end), linesB.slice(blockB.end))
    )
      problems.push(`${stream}: a line outside the usage block of omo ${command} changed`)
    if (!same(blockA.verbs, blockB.verbs)) {
      problems.push(`${stream}: the usage block of omo ${command} changed its verbs or their layout`)
      continue
    }
    for (const [index, verb] of blockA.verbs.entries()) {
      const [lineA = "", lineB = ""] = [linesA[blockA.start + index], linesB[blockB.start + index]]
      if (lineA === lineB) continue
      const name = `${command} ${verb.slice(verb.indexOf(" ") + 1)}`
      const covering = named.filter(
        (row) =>
          row.verb === name &&
          row.changes.some((change) => change.before === lineA.trimEnd() && change.after === lineB.trimEnd()),
      )
      for (const row of covering) matched.add(row.verb)
      if (covering.length === 0)
        problems.push(
          `${stream}: usage line ${JSON.stringify(lineB.trimEnd())} of ${name} changed with no row naming that verb and this before/after`,
        )
    }
  }
  if (!same(goldens.head[scenario.id], after) || same(goldens.base?.[scenario.id], goldens.head[scenario.id]))
    problems.push(`goldens.json does not carry the head's new outcome for ${scenario.id} in this pull request`)
  return problems
}
