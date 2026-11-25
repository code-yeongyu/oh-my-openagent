import { namespaceOf, p1aRows, type Contract } from "./contract-check"
import { decodeFixtures } from "./bytes-fixtures"
import type { Row } from "./schema"
import type { Expectation, ScenarioTableFile, TableScenario } from "./scenario-table"

// The scenario table of design 7.3 against the P1a rows: each scenario is an input the call's schema accepts (or a
// marked invalid one) and expectations a fake port can compare, never prose; each behaviour input of a row changes what
// the fakes observe; and a row's `scenarios` field stays empty until P1b's drivers have run them.

const ID = /^[a-z][A-Za-z0-9.]*\/[a-z0-9]+(-[a-z0-9]+)*$/

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  )

function expectationProblems(at: string, expectations: readonly Expectation[], contract: Contract): string[] {
  const problems: string[] = []
  if (expectations.length === 0)
    problems.push(`${at}: has no observable expected effect; name a port operation a fake observes`)
  for (const expectation of expectations) {
    const operations = contract.ports[expectation.port]
    if (operations === undefined) problems.push(`${at}: ${expectation.port} is not a port of design 4.6`)
    else if (!operations.includes(expectation.op))
      problems.push(`${at}: ${expectation.port} has no operation ${expectation.op}`)
    if (expectation.count !== undefined && (!Number.isInteger(expectation.count) || expectation.count < 0))
      problems.push(`${at}: count is a whole number of calls, 0 for none`)
  }
  return problems
}

function scenarioShapeProblems(scenario: TableScenario, row: Row, domain: string, contract: Contract): string[] {
  const at = `scenario ${scenario.id}`
  const problems = expectationProblems(at, scenario.expect, contract)
  if (namespaceOf(row.sdk) !== domain) problems.push(`${at}: belongs in scenarios/${namespaceOf(row.sdk)}.json`)
  const accepted = contract.accepts(row.sdk, decodeFixtures(scenario.input, problems, at))
  if (scenario.invalid === true) {
    if (accepted) problems.push(`${at}: marked invalid, but ${row.sdk}'s schema accepts its input`)
    if (scenario.refusal !== "invalid_arguments") problems.push(`${at}: an invalid input is refused invalid_arguments`)
  } else if (!accepted) problems.push(`${at}: ${row.sdk}'s schema refuses its input; fix the input or mark it invalid`)
  if (scenario.kind === "effect" && scenario.refusal !== undefined)
    problems.push(`${at}: an effect scenario names no refusal`)
  if (scenario.kind === "refusal" && scenario.refusal === undefined)
    problems.push(`${at}: a refusal scenario names its code`)
  return problems
}

const without = (input: Readonly<Record<string, unknown>>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== field))

// An optional input changes behaviour only if a scenario that passes it has a partner whose input is the same without
// it (effect or refusal, so a field that makes a call admissible pairs with the refusal it lifts) and whose kind or
// expectations differ. A required input, or one every form that has it requires, pairs with none.
function coverageProblems(
  row: Row,
  scenarios: readonly TableScenario[],
  inert: ReadonlyMap<string, string>,
  contract: Contract,
): string[] {
  const problems: string[] = []
  const effects = scenarios.filter((scenario) => scenario.kind === "effect")
  if (effects.length === 0) problems.push(`row ${row.id}: no effect scenario; add one the fake ports observe`)
  const call = contract.calls[row.sdk]
  for (const field of Object.keys(call?.properties ?? {})) {
    const reason = inert.get(`${row.id}.${field}`)
    const withField = effects.filter((scenario) => field in scenario.input)
    if (withField.length === 0) {
      if (reason === undefined || reason.trim() === "")
        problems.push(
          `row ${row.id}: input ${field} changes no effect scenario; add one, or list it as inert with the reason`,
        )
      continue
    }
    if (reason !== undefined) problems.push(`row ${row.id}: input ${field} is listed inert and has an effect scenario`)
    if (call?.required.includes(field) === true || call?.formRequired?.includes(field) === true) continue
    const paired = withField.some((scenario) => {
      const rest = canonical(without(scenario.input, field))
      return scenarios.some(
        (partner) =>
          !(field in partner.input) &&
          canonical(partner.input) === rest &&
          (partner.kind !== scenario.kind || canonical(partner.expect) !== canonical(scenario.expect)),
      )
    })
    if (!paired) problems.push(`row ${row.id}: input ${field} has no scenario pair that differs in ${field} alone`)
  }
  return problems
}

export function scenarioProblems(
  rows: readonly Row[],
  contract: Contract,
  files: readonly ScenarioTableFile[],
): string[] {
  const problems: string[] = []
  const inScope = new Map(p1aRows(rows, contract.gated).map((row) => [row.id, row]))
  const seen = new Set<string>()
  const byRow = new Map<string, TableScenario[]>()
  for (const file of files)
    for (const scenario of file.scenarios) {
      if (seen.has(scenario.id)) problems.push(`scenario ${scenario.id}: the id is used twice`)
      seen.add(scenario.id)
      if (!ID.test(scenario.id) || !scenario.id.startsWith(`${scenario.row}/`))
        problems.push(`scenario ${scenario.id}: the id must be <row>/<kebab-slug> for row ${scenario.row}`)
      const row = inScope.get(scenario.row)
      if (row === undefined) {
        problems.push(`scenario ${scenario.id}: row ${scenario.row} is not a P1a row`)
        continue
      }
      problems.push(...scenarioShapeProblems(scenario, row, file.domain, contract))
      if (scenario.invalid !== true) byRow.set(row.id, [...(byRow.get(row.id) ?? []), scenario])
    }
  const inert = new Map(files.flatMap((file) => Object.entries(file.inert)))
  for (const row of inScope.values()) {
    problems.push(...coverageProblems(row, byRow.get(row.id) ?? [], inert, contract))
    const named = [...row.scenarios.effect, ...row.scenarios.refusal]
    if (named.length > 0)
      problems.push(`row ${row.id}: scenarios stays empty in P1a; P1b fills it once its drivers ran`)
    for (const id of named)
      if (!seen.has(id)) problems.push(`row ${row.id}: scenario ${id} is not in the scenario table`)
  }
  for (const key of inert.keys()) {
    const cut = key.lastIndexOf(".")
    const row = inScope.get(key.slice(0, cut))
    if (row === undefined || contract.calls[row.sdk]?.properties[key.slice(cut + 1)] === undefined)
      problems.push(`inert ${key}: names no input of a P1a row`)
  }
  return problems
}
