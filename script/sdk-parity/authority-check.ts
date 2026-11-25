import {
  assertedExpectation,
  type BehaviourChange,
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
  if (canonical(ids) !== canonical(["B1", "B2", "B3", "B4", "B5", "B6"]))
    problems.push(`behaviour changes: section 10 approves exactly B1 to B6, the table has ${ids.join(", ")}`)
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
