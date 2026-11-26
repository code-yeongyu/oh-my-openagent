import { readFileSync } from "node:fs"
import { join } from "node:path"
import { namespaceOf, p1aRows, type Contract } from "./contract-check"
import { answerFields, boundaryInput } from "./bytes-fixtures"
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
  // A marked field's value is an earlier call's answer, supplied at run time: only that value is exempt; every other
  // field is checked against the call's schema as usual.
  const marked = answerFields(scenario.input)
  const accepted =
    contract.accepts(row.sdk, boundaryInput(scenario.input, problems, at), marked) &&
    marked.every((field) => Object.hasOwn(row.input.properties, field))
  if (scenario.invalid === true) {
    if (accepted) problems.push(`${at}: marked invalid, but ${row.sdk}'s schema accepts its input`)
    if (scenario.refusal !== "invalid_arguments") problems.push(`${at}: an invalid input is refused invalid_arguments`)
  } else if (!accepted) problems.push(`${at}: ${row.sdk}'s schema refuses its input; fix the input or mark it invalid`)
  if (scenario.kind === "effect" && scenario.refusal !== undefined)
    problems.push(`${at}: an effect scenario names no refusal`)
  if (scenario.kind === "refusal" && scenario.refusal === undefined)
    problems.push(`${at}: a refusal scenario names its code`)
  problems.push(...refusalDetailsProblems(at, scenario, contract))
  problems.push(...callbackProblems(at, scenario))
  problems.push(...callOptionProblems(at, scenario))
  return problems
}

// refusal_details is a subset of a refusal's failure details; where the code's registry entry lists closed reasons,
// the reason it names is one of them.
function refusalDetailsProblems(at: string, scenario: TableScenario, contract: Contract): string[] {
  const details = scenario.refusal_details
  if (details === undefined) return []
  if (scenario.kind !== "refusal") return [`${at}: refusal_details belongs to a refusal`]
  const reasons = contract.registry[scenario.refusal ?? ""]?.reasons
  if (reasons === undefined) return []
  const reason = details["reason"]
  return typeof reason === "string" && reasons.includes(reason)
    ? []
    : [`${at}: refusal_details.reason must be one of ${scenario.refusal}'s reasons (${reasons.join(", ")})`]
}

// A callback's calls are not port operations: each entry names a callback input the scenario passes as "$callback",
// matches its argument by a subset, and states how many effects the trace holds when it is called.
function callbackProblems(at: string, scenario: TableScenario): string[] {
  return Object.entries(scenario.callbacks ?? {}).flatMap(([name, entries]) => [
    ...(scenario.input[name] === "$callback" ? [] : [`${at}: callbacks.${name} names no "$callback" input`]),
    ...(entries.length === 0 ? [`${at}: callbacks.${name} lists no call`] : []),
    ...entries.flatMap((entry, index) => [
      ...(Number.isInteger(entry.effects_before) && entry.effects_before >= 0
        ? []
        : [`${at}: callbacks.${name}[${index}].effects_before is a whole number of effects`]),
      ...(entry.pending === true && entry.answer !== undefined
        ? [`${at}: callbacks.${name}[${index}] never answers, so it states no answer`]
        : []),
    ]),
  ])
}

// call_options.deadline_ms is a whole number of virtual milliseconds the call is allowed.
function callOptionProblems(at: string, scenario: TableScenario): string[] {
  const deadline = scenario.call_options?.deadline_ms
  return deadline === undefined || (Number.isInteger(deadline) && deadline >= 0)
    ? []
    : [`${at}: call_options.deadline_ms is a whole number of milliseconds`]
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

/**
 * Which slice fills each row's `scenarios` (row id to slice): each slice adds its own rows in its own pull request, and
 * the check holds both ways: a filled row must be mapped, and a mapped row must be filled.
 */
export const SCENARIO_FILL_OWNERS: Readonly<Record<string, string>> = (
  JSON.parse(readFileSync(join(import.meta.dir, "scenario-fill-owners.json"), "utf8")) as {
    readonly rows: Readonly<Record<string, string>>
  }
).rows

export function scenarioProblems(
  rows: readonly Row[],
  contract: Contract,
  files: readonly ScenarioTableFile[],
  owners: Readonly<Record<string, string>> = SCENARIO_FILL_OWNERS,
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
      problems.push(...beforeProblems(scenario, inScope, contract))
      for (const [field, value] of Object.entries((scenario.input ?? {}) as Readonly<Record<string, unknown>>))
        if (value === "$callback" && !Object.hasOwn(Object(row.input.properties[field]), "x-callback"))
          problems.push(
            `scenario ${scenario.id}: ${field} is passed a callback, but row ${row.id} does not type it as one; type it with the contract's callback helper (its argument and answer shapes)`,
          )
      if (scenario.invalid !== true) byRow.set(row.id, [...(byRow.get(row.id) ?? []), scenario])
    }
  const inert = new Map(files.flatMap((file) => Object.entries(file.inert)))
  for (const row of inScope.values()) {
    problems.push(...coverageProblems(row, byRow.get(row.id) ?? [], inert, contract))
    problems.push(...targetStateProblems(row, byRow.get(row.id) ?? []))
    const named = [...row.scenarios.effect, ...row.scenarios.refusal]
    const owner = owners[row.id]
    if (named.length > 0 && owner === undefined)
      problems.push(
        `row ${row.id}: scenarios stays empty in P1a until the slice that fills it maps the row to itself in scenario-fill-owners.json`,
      )
    if (named.length === 0 && owner !== undefined)
      problems.push(
        `row ${row.id}: scenario-fill-owners.json maps it to slice ${owner}, which has not filled its scenarios`,
      )
    for (const id of named)
      if (!seen.has(id)) problems.push(`row ${row.id}: scenario ${id} is not in the scenario table`)
  }
  for (const [id, slice] of Object.entries(owners)) {
    if (!inScope.has(id)) problems.push(`scenario-fill-owners.json names ${id}, which is not a P1a row`)
    if (slice === "") problems.push(`scenario-fill-owners.json maps ${id} to no slice`)
  }
  for (const key of inert.keys()) {
    const cut = key.lastIndexOf(".")
    const row = inScope.get(key.slice(0, cut))
    if (row === undefined || contract.calls[row.sdk]?.properties[key.slice(cut + 1)] === undefined)
      problems.push(`inert ${key}: names no input of a P1a row`)
  }
  return problems
}

// `$answer:<n>` names the answer of the scenario's n-th before-call; the runner substitutes it before the call, so the
// table check only requires each marked field to be one the call takes. It is a general form, not an install case.
const MARKER = /^\$answer:([1-9][0-9]*)$/

function beforeProblems(scenario: TableScenario, rows: ReadonlyMap<string, Row>, contract: Contract): string[] {
  const at = `scenario ${scenario.id}`
  const before = scenario.before ?? []
  const problems: string[] = []
  for (const [index, call] of before.entries()) {
    const row = rows.get(call.row)
    if (row === undefined) problems.push(`${at}: before[${index}] names ${call.row}, which is not a P1a row`)
    else if (namespaceOf(row.sdk) !== namespaceOf(scenario.row))
      problems.push(`${at}: before[${index}] calls ${call.row}, outside the scenario's namespace`)
    else if (answerFields(call.input).length > 0 || !contract.accepts(row.sdk, call.input))
      problems.push(`${at}: before[${index}]'s input is not one ${row.sdk}'s schema accepts`)
  }
  for (const input of [scenario.input, ...(scenario.then ?? []).map((step) => step.input)])
    for (const field of answerFields(input)) {
      const n = Number(MARKER.exec(String(input[field]))?.[1])
      if (n > before.length)
        problems.push(`${at}: ${field} names $answer:${n}, but the scenario has ${before.length} before-call(s)`)
    }
  return problems
}
