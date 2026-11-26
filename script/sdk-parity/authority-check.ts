import {
  assertedExpectation,
  type BehaviourChange,
  type Cell,
  isPrincipal,
  type MatrixLine,
  PRINCIPAL_KINDS,
  type Refusal,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import type { Row } from "./schema"
import type { ScenarioTableFile, TableScenario } from "./scenario-table"

// Slice P1a-s (#14949): the principal matrix of the security design's section 4, its refusal scenarios and the approved
// behaviour changes of its section 10, against the registry and the scenario table. Each check returns the problems it
// finds; the tests assert the real tree has none and that each check fails on a fixture that breaks it.

const canonical = (value: unknown): string => JSON.stringify(value)

export function matrixProblems(
  lines: readonly MatrixLine[],
  rows: readonly Row[],
  document: string,
  sourceCodes: readonly string[],
): string[] {
  const problems: string[] = []
  const capabilities = new Set(rows.filter((row) => row.kind === "capability").map((row) => row.id))
  for (const line of lines) {
    const at = `matrix ${line.section} ${line.capability}`
    if ((line.rows.length === 0) !== (line.noRow !== undefined))
      problems.push(`${at}: a line names rows, or says in noRow why it has none`)
    for (const id of line.rows) if (!capabilities.has(id)) problems.push(`${at}: row ${id} is not a capability row`)
    const same = canonical(line.cells.person) === canonical(line.cells.script)
    if (!same && line.split === undefined)
      problems.push(`${at}: person and script differ without a quote from the document saying so`)
    if (same && line.split !== undefined) problems.push(`${at}: person and script share the cell, so it needs no split`)
    if (line.split !== undefined && !document.includes(line.split))
      problems.push(`${at}: the split quote is not in the security design: ${line.split}`)
    for (const kind of PRINCIPAL_KINDS) {
      const cell = line.cells[kind]
      if (cell.outcome === "refuse" && !sourceCodes.includes(cell.code))
        problems.push(`${at}: ${kind} is refused with ${cell.code}, not a code of design 4.4's source lists`)
    }
  }
  return problems
}

type DocumentRow = { readonly section: string; readonly capability: string; readonly columns: readonly string[] }

/** The rows of the security design's section 4 tables (4.1 to 4.4): first column, then the four principal columns. */
export function sectionFourRows(document: string): DocumentRow[] {
  const rows: DocumentRow[] = []
  let section = ""
  for (const line of document.split("\n")) {
    const heading = /^### (4\.[1-5]) /.exec(line)
    if (heading !== null) section = heading[1] ?? ""
    if (line.startsWith("## 5")) break
    if (section === "" || section === "4.5" || !line.startsWith("| ") || line.startsWith("| Capability")) continue
    const cells = line.slice(2, -2).split(" | ")
    rows.push({ section, capability: cells[0] ?? "", columns: cells.slice(1, 5) })
  }
  return rows
}

const tokenOf = (column: string): Cell["outcome"] | "as session" =>
  column.startsWith("n/a")
    ? "n/a"
    : column.startsWith("as session")
      ? "as session"
      : column.startsWith("R")
        ? "refuse"
        : "allow"

// Completeness against the document itself: every row of section 4 has a line, every line comes from a row, and a line
// that is the row (no `docRow`) has, in each column, the outcome the document's cell starts with.
export function documentRowProblems(lines: readonly MatrixLine[], document: string): string[] {
  const problems: string[] = []
  const rows = sectionFourRows(document)
  const source = (line: MatrixLine): string => line.docRow ?? line.capability
  for (const row of rows)
    if (!lines.some((line) => source(line) === row.capability && line.section === row.section))
      problems.push(`section ${row.section} row "${row.capability}": no line of the matrix`)
  for (const line of lines) {
    const row = rows.find((candidate) => candidate.capability === source(line) && candidate.section === line.section)
    if (row === undefined) {
      problems.push(`matrix ${line.section} "${source(line)}": not a row of the document's section ${line.section}`)
      continue
    }
    if (line.docRow !== undefined) continue
    const [people = "", session = "", connector = "", service = ""] = row.columns.map(tokenOf)
    const want = (token: string, cell: Cell): boolean =>
      token === "as session" ? canonical(cell) === canonical(line.cells.session) : token === cell.outcome
    const peopleOk =
      line.split === undefined
        ? want(people, line.cells.person) && want(people, line.cells.script)
        : want(people, line.cells.person) || want(people, line.cells.script)
    if (!peopleOk)
      problems.push(`matrix ${line.section} "${line.capability}": person/script is not the document's ${people}`)
    if (!want(session, line.cells.session))
      problems.push(`matrix ${line.section} "${line.capability}": session is not ${session}`)
    if (!want(connector, line.cells.connector))
      problems.push(`matrix ${line.section} "${line.capability}": connector is not ${connector}`)
    if (!want(service, line.cells.service))
      problems.push(`matrix ${line.section} "${line.capability}": service is not ${service}`)
  }
  return problems
}

/** A backticked name in a row of section 4 that is not itself a registry row id, read as the call it names. */
export type CallAlias = {
  readonly docRow: string
  readonly token: string
  readonly calls: readonly string[]
  readonly why: string
}

// The calls a row of section 4 names: each backticked token that is a registry row, or completes one against the last
// full name before it (`daemon.ensure`, `stop` is daemon.stop), or a wildcard (`account.store.*`). Other tokens are prose.
function documentCalls(capability: string, ids: ReadonlySet<string>, aliases: readonly CallAlias[]): string[] {
  const calls: string[] = []
  let prefix = ""
  for (const match of capability.matchAll(/`([^`]+)`/g)) {
    const token = (match[1] ?? "").replace(/\(.*$/, "")
    const alias = aliases.find((entry) => entry.docRow === capability && entry.token === token)
    if (alias !== undefined) {
      calls.push(...alias.calls)
      continue
    }
    if (token.endsWith(".*")) {
      calls.push(...[...ids].filter((id) => id.startsWith(token.slice(0, -1))))
      continue
    }
    if (ids.has(token)) {
      calls.push(token)
      prefix = token.slice(0, token.lastIndexOf(".") + 1)
      continue
    }
    for (let scope = prefix; scope !== ""; scope = scope.slice(0, scope.slice(0, -1).lastIndexOf(".") + 1))
      if (ids.has(`${scope}${token}`)) {
        calls.push(`${scope}${token}`)
        break
      }
  }
  return [...new Set(calls)]
}

// The refusal table's inventory derived from the document: every call a row names has a line, and for the line that is
// the row, every refused principal has exactly one refusal on each of its calls; every refusal traces to a row.
export function inventoryProblems(
  lines: readonly MatrixLine[],
  refusals: readonly Refusal[],
  document: string,
  ids: ReadonlySet<string>,
  aliases: readonly CallAlias[],
): string[] {
  const problems: string[] = []
  const rows = sectionFourRows(document)
  const source = (line: MatrixLine): string => line.docRow ?? line.capability
  for (const row of rows) {
    const traced = lines.filter((line) => source(line) === row.capability && line.section === row.section)
    const covered = new Set(traced.flatMap((line) => line.rows))
    for (const call of documentCalls(row.capability, ids, aliases))
      if (!covered.has(call))
        problems.push(`section ${row.section} row "${row.capability}": names ${call}, which no line covers`)
    const primary = traced.find((line) => line.docRow === undefined)
    if (primary === undefined) continue
    for (const call of primary.rows)
      for (const kind of PRINCIPAL_KINDS) {
        const count = refusals.filter(
          (entry) =>
            entry.row === call &&
            entry.principal === kind &&
            entry.scenario.startsWith(`${call}/${primary.slug}-refuses-`),
        ).length
        const want = primary.cells[kind].outcome === "refuse" ? 1 : 0
        if (count !== want)
          problems.push(
            `section ${row.section} row "${row.capability}": ${call} for ${kind} has ${count} refusals, the document says ${want}`,
          )
      }
  }
  for (const entry of refusals) {
    const line = lines.find(
      (candidate) =>
        candidate.rows.includes(entry.row) &&
        entry.scenario === `${entry.row}/${candidate.slug}-refuses-${entry.principal}`,
    )
    if (line === undefined || !rows.some((row) => row.capability === source(line)))
      problems.push(`refusal ${entry.scenario}: traces to no row of the document's section 4`)
  }
  return problems
}

export function refusalScenarioProblems(
  refusals: readonly Refusal[],
  changes: readonly BehaviourChange[],
  files: readonly ScenarioTableFile[],
): string[] {
  const problems: string[] = []
  const byId = new Map(files.flatMap((file) => file.scenarios).map((scenario) => [scenario.id, scenario]))
  const byChange = new Map(changes.map((change) => [change.id, change]))
  const expected = new Set(refusals.map((refusal) => refusal.scenario))
  for (const refusal of refusals) {
    const scenario = byId.get(refusal.scenario)
    const at = `refusal ${refusal.scenario}`
    if (scenario === undefined) {
      problems.push(`${at}: no scenario in the scenario table`)
      continue
    }
    if (scenario.row !== refusal.row) problems.push(`${at}: the scenario is on row ${scenario.row}`)
    if (scenario.principal?.kind !== refusal.principal || !isPrincipal(scenario.principal))
      problems.push(`${at}: the scenario's root is not built for a ${refusal.principal} principal`)
    if (scenario.change !== refusal.change)
      problems.push(`${at}: the scenario is not tied to ${refusal.change ?? "no change"}`)
    const change = refusal.change === undefined ? undefined : byChange.get(refusal.change)
    if (change !== undefined && assertedExpectation(change).outcome === "allow") continue
    if (scenario.kind !== "refusal" || scenario.refusal !== refusal.code)
      problems.push(`${at}: the scenario must answer ${refusal.code}`)
    if (scenario.expect.length === 0 || scenario.expect.some((expectation) => expectation.count !== 0))
      problems.push(`${at}: a refusal is answered before any side effect; every expectation counts 0 calls`)
  }
  for (const scenario of files.flatMap((file) => file.scenarios))
    if (scenario.principal !== undefined && scenario.change === undefined && !expected.has(scenario.id))
      problems.push(`scenario ${scenario.id}: builds its root for a principal, but no cell of the matrix refuses it`)
  return problems
}

const assertsChange = (scenario: TableScenario, change: BehaviourChange): boolean => {
  const asserted = assertedExpectation(change)
  if (asserted.outcome === "allow") return scenario.kind === "effect"
  return scenario.kind === "refusal" && scenario.refusal === asserted.code
}

export function behaviourChangeProblems(
  changes: readonly BehaviourChange[],
  files: readonly ScenarioTableFile[],
): string[] {
  const problems: string[] = []
  const ids = changes.map((change) => change.id)
  if (canonical(ids) !== canonical(["B1", "B2", "B3", "B4", "B5", "B6", "B7"]))
    problems.push(`behaviour changes: the owner approved exactly B1 to B7, the table has ${ids.join(", ")}`)
  const byId = new Map(changes.map((change) => [change.id, change]))
  for (const change of changes) {
    if (change.exists === "today" && change.today.says.trim() === "")
      problems.push(`${change.id}: exists today, so it carries today's expectation`)
    if (change.exists === "new" && "today" in change) problems.push(`${change.id}: a new operation has no today`)
    if (change.evidence_present) problems.push(`${change.id}: no change's evidence exists at this head`)
  }
  for (const scenario of files.flatMap((file) => file.scenarios)) {
    if (scenario.change === undefined) continue
    const change = byId.get(scenario.change as BehaviourChange["id"])
    if (change === undefined) {
      problems.push(`scenario ${scenario.id}: names ${scenario.change}, not an approved change`)
      continue
    }
    if (!change.rows.includes(scenario.row))
      problems.push(`scenario ${scenario.id}: ${change.id} does not cover ${scenario.row}`)
    if (!assertsChange(scenario, change))
      problems.push(
        `scenario ${scenario.id}: asserts other than ${change.id}'s ${change.evidence_present || change.exists === "new" ? "approved" : "today"} expectation`,
      )
  }
  return problems
}

/** A disagreement with the document that a named revision of it settles; it must still occur, or it is stale. */
export type AwaitingRevision = { readonly problem: string; readonly why: string }

export function withoutAwaited(problems: readonly string[], awaited: readonly AwaitingRevision[]): string[] {
  const out = problems.filter((problem) => !awaited.some((entry) => entry.problem === problem))
  for (const entry of awaited)
    if (!problems.includes(entry.problem))
      out.push(`awaiting revision is stale, the document settled it: ${entry.problem}`)
  return out
}
