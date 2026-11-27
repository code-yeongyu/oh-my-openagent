import { namespaceOf, p1aRows, type Contract } from "./contract-check"
import { decodeFixtures } from "./bytes-fixtures"
import type { Row } from "./schema"
import type { Expectation, ScenarioTableFile, TableScenario } from "./scenario-table"

// The scenario table of design 7.3 against the P1a rows: each scenario is an input the call's schema accepts (or a
// marked invalid one) and expectations a fake port can compare, never prose; each behaviour input of a row changes what
// the fakes observe; and a row's `scenarios` field stays empty until P1b's drivers have run them.

const ID = /^[a-z][A-Za-z0-9.]*\/[a-z0-9]+(-[a-z0-9]+)*$/

// What the matcher compares: no result (the fake's stimulus), count defaulting to one, and the order of expectations
// not significant, so two lists that differ only in those read as the same effect.
const withoutResult = (expectations: readonly Expectation[]): readonly string[] =>
  expectations.map(({ result: _stimulus, count, ...rest }) => canonical({ ...rest, count: count ?? 1 })).toSorted()

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

export function scenarioShapeProblems(scenario: TableScenario, row: Row, domain: string, contract: Contract): string[] {
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
// it, either being an effect or a refusal (a field can lift a refusal or cause one), and whose kind or expectations
// differ. A required input, or one every form that has it requires, pairs with none.
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
    const paired = scenarios
      .filter((scenario) => field in scenario.input)
      .some((scenario) => {
        const rest = canonical(without(scenario.input, field))
        return scenarios.some(
          (partner) =>
            !(field in partner.input) &&
            canonical(partner.input) === rest &&
            (partner.kind !== scenario.kind ||
              canonical(withoutResult(partner.expect)) !== canonical(withoutResult(scenario.expect))),
        )
      })
    if (!paired) problems.push(`row ${row.id}: input ${field} has no scenario pair that differs in ${field} alone`)
  }
  problems.push(...enumProblems(row, scenarios, contract))
  return problems
}

// The values an input field enumerates (an enum, or a union of constants), each of which some admitted scenario must
// pass: a pair proves the field is honoured, not that every value of it is (design 6.11, one scenario per key and value).
const enumerated = (schema: unknown): readonly unknown[] | undefined => {
  const node = schema as {
    readonly enum?: readonly unknown[]
    readonly anyOf?: readonly { readonly const?: unknown }[]
  }
  if (node.enum !== undefined) return node.enum
  if (node.anyOf !== undefined && node.anyOf.length > 0 && node.anyOf.every((variant) => "const" in variant))
    return node.anyOf.map((variant) => variant.const)
  return undefined
}

function enumProblems(row: Row, scenarios: readonly TableScenario[], contract: Contract): string[] {
  const problems: string[] = []
  for (const [field, schema] of Object.entries(contract.calls[row.sdk]?.properties ?? {})) {
    const values = enumerated(schema)
    if (values === undefined) continue
    for (const value of values)
      if (!scenarios.some((scenario) => canonical(scenario.input[field]) === canonical(value)))
        problems.push(`row ${row.id}: input ${field} value ${JSON.stringify(value)} is in no scenario`)
  }
  return problems
}

// Design 7.3: every control verb on a live, an ended and an offline target, each declared as the fixture state of
// the scenario (`given`), so the driver can set it up rather than read it from prose.
const CONTROL_VERBS = [
  "threads.send",
  "threads.interrupt",
  "threads.close",
  "threads.setModel",
  "threads.setReasoning",
  "threads.rename",
  "threads.archive",
  "threads.handoff",
]

type Given = { readonly state?: { readonly session?: string; readonly online?: boolean } }
const givenOf = (scenario: TableScenario): readonly Given[] =>
  (scenario as { readonly given?: readonly Given[] }).given ?? []

function targetStateProblems(row: Row, scenarios: readonly TableScenario[]): string[] {
  if (!CONTROL_VERBS.includes(row.id)) return []
  const states: readonly [string, (given: Given) => boolean][] = [
    ["a live session (given session: live)", (given) => given.state?.["session"] === "live"],
    ["an ended session (given session: ended)", (given) => given.state?.["session"] === "ended"],
    ["an offline device (given online: false)", (given) => given.state?.["online"] === false],
  ]
  return states.flatMap(([name, matches]) =>
    scenarios.some((scenario) => givenOf(scenario).some(matches)) ? [] : [`row ${row.id}: no scenario on ${name}`],
  )
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
    problems.push(...targetStateProblems(row, byRow.get(row.id) ?? []))
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
