import type { FieldSchema, Row } from "./schema"
import type { ScenarioTableFile } from "./scenario-table"
import { schemaDifferences } from "./tool-check"

// Slice P1a (#14948): the root's typed contract against the registry. Each check returns the problems it finds, each
// naming the row, call, field, code or scenario to fix; the tests assert the real tree has none and that each check
// fails on a fixture that breaks it.

export type CallInput = {
  readonly properties: Readonly<Record<string, FieldSchema>>
  readonly required: readonly string[]
}

export type GatedEntry = {
  readonly row: string
  readonly field?: string
  readonly s0: readonly string[]
  readonly reason: string
  readonly rowExists: boolean
}

export type Contract = {
  readonly calls: Readonly<Record<string, CallInput>>
  readonly gated: readonly GatedEntry[]
  readonly ports: readonly string[]
  readonly registry: Readonly<Record<string, { readonly namespaces: readonly string[]; readonly next_action: string }>>
  readonly heldCodes: Readonly<Record<string, string>>
  readonly sourceCodes: readonly string[]
  readonly accepts: (call: string, input: unknown) => boolean
}

const ROOT = "root"
const namespaceOf = (key: string): string => key.split(".")[0] ?? key
const heldRows = (gated: readonly GatedEntry[]): Set<string> =>
  new Set(gated.filter((entry) => entry.field === undefined && entry.row !== ROOT).map((entry) => entry.row))
const heldFields = (gated: readonly GatedEntry[], row: string): Set<string> =>
  new Set(gated.filter((entry) => entry.row === row && entry.field !== undefined).map((entry) => entry.field ?? ""))

export const p1aRows = (rows: readonly Row[], gated: readonly GatedEntry[]): Row[] =>
  rows.filter((row) => row.kind === "capability" && !heldRows(gated).has(row.id))

export function scopeProblems(rows: readonly Row[], contract: Contract): string[] {
  const problems: string[] = []
  const byId = new Map(rows.map((row) => [row.id, row]))
  const inScope = p1aRows(rows, contract.gated)
  for (const row of inScope)
    if (contract.calls[row.sdk] === undefined)
      problems.push(
        `row ${row.id}: the root type has no call ${row.sdk}; add it, or hold the row in GATED with its S0 section`,
      )
  const sdks = new Set(inScope.map((row) => row.sdk))
  for (const key of Object.keys(contract.calls))
    if (!sdks.has(key)) problems.push(`call ${key}: no P1a row names it; remove it or give it a row`)
  for (const entry of contract.gated) {
    const at = `GATED ${entry.row}${entry.field === undefined ? "" : `.${entry.field}`}`
    if (entry.s0.length === 0 && entry.reason.trim() === "")
      problems.push(`${at}: cite the security design section that holds it, or say why it is held without one`)
    if (entry.row === ROOT) continue
    const row = byId.get(entry.row)
    if (entry.rowExists && row === undefined) problems.push(`${at}: names row ${entry.row}, which does not exist`)
    if (!entry.rowExists && row !== undefined) problems.push(`${at}: row ${entry.row} exists now; mark rowExists`)
    if (entry.field === undefined || row === undefined) continue
    if (row.input.properties[entry.field] === undefined)
      problems.push(`${at}: ${row.sdk} has no input ${entry.field}; remove the entry`)
    if (contract.calls[row.sdk]?.properties[entry.field] !== undefined)
      problems.push(`${at}: the root type takes ${entry.field} on ${row.sdk}, which P1a holds for P1a-s; remove it`)
  }
  return problems
}

export function inputProblems(rows: readonly Row[], contract: Contract): string[] {
  const problems: string[] = []
  for (const row of p1aRows(rows, contract.gated)) {
    const call = contract.calls[row.sdk]
    if (call === undefined) continue
    const held = heldFields(contract.gated, row.id)
    const rowFields = Object.keys(row.input.properties).filter((field) => !held.has(field))
    const callFields = Object.keys(call.properties)
    for (const field of rowFields)
      if (!callFields.includes(field))
        problems.push(`row ${row.id}: input ${field} is missing from the schema of ${row.sdk}`)
    for (const field of callFields)
      if (!rowFields.includes(field))
        problems.push(`row ${row.id}: the schema of ${row.sdk} takes ${field}, which the row lacks`)
    for (const field of rowFields.filter((name) => callFields.includes(name)))
      problems.push(
        ...schemaDifferences(row.input.properties[field], call.properties[field], `row ${row.id} input ${field}`),
      )
    const required = (list: readonly string[]): string => JSON.stringify(list.filter((f) => !held.has(f)).toSorted())
    if (required(row.input.required) !== required(call.required))
      problems.push(
        `row ${row.id}: required is ${required(row.input.required)} in the row and ${required(call.required)} in the schema`,
      )
  }
  return problems
}

const usedCodes = (
  rows: readonly Row[],
  contract: Contract,
  files: readonly ScenarioTableFile[],
): Map<string, Set<string>> => {
  const inScope = new Map(p1aRows(rows, contract.gated).map((row) => [row.id, row]))
  const used = new Map<string, Set<string>>()
  for (const scenario of files.flatMap((file) => file.scenarios)) {
    const row = inScope.get(scenario.row)
    if (scenario.refusal === undefined || row === undefined) continue
    used.set(scenario.refusal, (used.get(scenario.refusal) ?? new Set()).add(namespaceOf(row.sdk)))
  }
  return used
}

export function codeProblems(rows: readonly Row[], contract: Contract, files: readonly ScenarioTableFile[]): string[] {
  const problems: string[] = []
  const used = usedCodes(rows, contract, files)
  const sources = new Set(contract.sourceCodes)
  for (const [code, namespaces] of used) {
    const entry = contract.registry[code]
    if (entry === undefined) {
      problems.push(`code ${code}: returned by ${[...namespaces].join(", ")} and missing from the code registry`)
      continue
    }
    const want = JSON.stringify([...namespaces].toSorted())
    const have = JSON.stringify([...entry.namespaces].toSorted())
    if (want !== have)
      problems.push(`code ${code}: the registry names namespaces ${have}; the rows that return it are ${want}`)
  }
  for (const [code, entry] of Object.entries(contract.registry)) {
    if (!used.has(code))
      problems.push(`code ${code}: no row returns it; remove it from the registry or declare the refusal`)
    if (entry.next_action.trim() === "") problems.push(`code ${code}: give it a next_action form`)
    if (!sources.has(code)) problems.push(`code ${code}: not a code of the three source lists of design 4.4`)
    if (contract.heldCodes[code] !== undefined) problems.push(`code ${code}: both in the registry and held`)
  }
  for (const code of sources)
    if (contract.registry[code] === undefined && contract.heldCodes[code] === undefined)
      problems.push(`code ${code}: a source code of design 4.4 that is neither in the registry nor held with a reason`)
  for (const code of Object.keys(contract.heldCodes))
    if (!sources.has(code)) problems.push(`held code ${code}: not a source code; remove it`)
  return problems
}

const ID = /^[a-z][A-Za-z0-9.]*\/[a-z0-9]+(-[a-z0-9]+)*$/

export function scenarioProblems(
  rows: readonly Row[],
  contract: Contract,
  files: readonly ScenarioTableFile[],
): string[] {
  const problems: string[] = []
  const inScope = new Map(p1aRows(rows, contract.gated).map((row) => [row.id, row]))
  const ports = new Set(contract.ports)
  const seen = new Set<string>()
  const covered = new Map<string, Set<string>>()
  for (const file of files)
    for (const scenario of file.scenarios) {
      const at = `scenario ${scenario.id}`
      if (seen.has(scenario.id)) problems.push(`${at}: the id is used twice`)
      seen.add(scenario.id)
      if (!ID.test(scenario.id) || !scenario.id.startsWith(`${scenario.row}/`))
        problems.push(`${at}: the id must be <row>/<kebab-slug> for row ${scenario.row}`)
      const row = inScope.get(scenario.row)
      if (row === undefined) {
        problems.push(`${at}: row ${scenario.row} is not a P1a row`)
        continue
      }
      if (namespaceOf(row.sdk) !== file.domain)
        problems.push(`${at}: belongs in scenarios/${namespaceOf(row.sdk)}.json`)
      if (scenario.expect.length === 0)
        problems.push(`${at}: has no observable expected effect; name what a fake port observes`)
      for (const expectation of scenario.expect) {
        if (!ports.has(expectation.port)) problems.push(`${at}: ${expectation.port} is not a port of design 4.6`)
        if (expectation.observes.trim() === "") problems.push(`${at}: say what ${expectation.port} observes`)
      }
      const accepted = contract.accepts(row.sdk, scenario.input)
      if (scenario.invalid === true) {
        if (accepted) problems.push(`${at}: marked invalid, but ${row.sdk}'s schema accepts its input`)
        if (scenario.refusal !== "invalid_arguments")
          problems.push(`${at}: an invalid input is refused invalid_arguments`)
      } else if (!accepted)
        problems.push(`${at}: ${row.sdk}'s schema refuses its input; fix the input or mark it invalid`)
      if (scenario.kind === "effect" && scenario.refusal !== undefined)
        problems.push(`${at}: an effect scenario names no refusal`)
      if (scenario.kind === "refusal" && scenario.refusal === undefined)
        problems.push(`${at}: a refusal scenario names its code`)
      if (scenario.kind === "effect" && scenario.invalid !== true) {
        const fields = covered.get(row.id) ?? new Set<string>()
        for (const field of Object.keys(scenario.input)) fields.add(field)
        covered.set(row.id, fields)
      }
    }
  const inert = new Map(files.flatMap((file) => Object.entries(file.inert)))
  for (const row of inScope.values()) {
    if (!covered.has(row.id)) problems.push(`row ${row.id}: no effect scenario; add one the fake ports observe`)
    for (const field of Object.keys(contract.calls[row.sdk]?.properties ?? {})) {
      const reason = inert.get(`${row.id}.${field}`)
      const hit = covered.get(row.id)?.has(field) === true
      if (!hit && (reason === undefined || reason.trim() === ""))
        problems.push(
          `row ${row.id}: input ${field} changes no effect scenario; add one, or list it as inert with the reason`,
        )
      if (hit && reason !== undefined)
        problems.push(`row ${row.id}: input ${field} is listed inert and has an effect scenario`)
    }
    for (const id of [...row.scenarios.effect, ...row.scenarios.refusal])
      if (!seen.has(id)) problems.push(`row ${row.id}: scenario ${id} is not in the scenario table`)
  }
  for (const key of inert.keys()) {
    const [rowId, field] = [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)]
    const row = inScope.get(rowId)
    if (row === undefined || contract.calls[row.sdk]?.properties[field] === undefined)
      problems.push(`inert ${key}: names no input of a P1a row`)
  }
  return problems
}
