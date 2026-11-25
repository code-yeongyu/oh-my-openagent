import type { FieldSchema, Row } from "./schema"
import type { ScenarioTableFile } from "./scenario-table"
import { schemaDifferences } from "./tool-check"

// Slice P1a (#14948): the root's typed contract against the registry. Each check returns the problems it finds, each
// naming the row, call, field, code or scenario to fix; the tests assert the real tree has none and that each check
// fails on a fixture that breaks it.

export type CallInput = {
  readonly properties: Readonly<Record<string, FieldSchema>>
  readonly required: readonly string[]
  readonly formRequired?: readonly string[]
}

export type GatedEntry = {
  readonly row: string
  readonly field?: string
  readonly s0: readonly string[]
  readonly reason: string
  readonly heldWithoutS0?: string
  readonly rowExists: boolean
}

export type HeldReason =
  | { readonly because: "held-rows"; readonly rows: readonly string[] }
  | { readonly because: "no-producer"; readonly note: string }
  | { readonly because: "inside-ok-answer"; readonly row: string; readonly note: string }
  | { readonly because: "principal-only"; readonly note: string }

export type Contract = {
  readonly calls: Readonly<Record<string, CallInput>>
  readonly gated: readonly GatedEntry[]
  readonly ports: Readonly<Record<string, readonly string[]>>
  readonly sections: readonly string[]
  readonly rootOptions: readonly string[]
  readonly registry: Readonly<Record<string, { readonly namespaces: readonly string[]; readonly next_action: string }>>
  readonly heldCodes: Readonly<Record<string, HeldReason>>
  readonly sourceCodes: readonly string[]
  readonly accepts: (call: string, input: unknown) => boolean
  /** Inputs the root types ahead of a row's descriptor until the slice that serves the call adds them. */
  readonly ahead?: readonly { readonly row: string; readonly field: string }[]
}

const ROOT = "root"
export const namespaceOf = (key: string): string => key.split(".")[0] ?? key
const heldRows = (gated: readonly GatedEntry[]): Set<string> =>
  new Set(gated.filter((entry) => entry.field === undefined && entry.row !== ROOT).map((entry) => entry.row))
const heldFields = (gated: readonly GatedEntry[], row: string): string[] =>
  gated.flatMap((entry) => (entry.row === row && entry.field !== undefined ? [entry.field] : []))

export const p1aRows = (rows: readonly Row[], gated: readonly GatedEntry[]): Row[] =>
  rows.filter((row) => row.kind === "capability" && !heldRows(gated).has(row.id))

type Node = FieldSchema & { readonly anyOf?: readonly Node[] }

// A dotted path is found in an object's properties or in any variant of a union.
const hasPath = (node: Node | undefined, path: readonly string[]): boolean => {
  if (node === undefined) return false
  const [head, ...rest] = path
  if (head === undefined) return true
  return (
    hasPath(node.properties?.[head] as Node | undefined, rest) ||
    (node.anyOf ?? []).some((variant) => hasPath(variant, path))
  )
}

const withoutPath = (node: Node, path: readonly string[]): Node => {
  const [head, ...rest] = path
  if (head === undefined) return node
  const properties = node.properties === undefined ? undefined : { ...node.properties }
  if (properties !== undefined && properties[head] !== undefined) {
    if (rest.length === 0) delete properties[head]
    else properties[head] = withoutPath(properties[head] as Node, rest)
  }
  return {
    ...node,
    ...(properties === undefined ? {} : { properties }),
    ...(rest.length === 0 && node.required !== undefined
      ? { required: node.required.filter((name) => name !== head) }
      : {}),
    ...(node.anyOf === undefined ? {} : { anyOf: node.anyOf.map((variant) => withoutPath(variant, path)) }),
  }
}

const asNode = (input: CallInput): Node => ({ properties: input.properties, required: input.required })

function gatedEntryProblems(entry: GatedEntry, byId: ReadonlyMap<string, Row>, contract: Contract): string[] {
  const problems: string[] = []
  const at = `GATED ${entry.row}${entry.field === undefined ? "" : `.${entry.field}`}`
  if (entry.s0.length === 0 && (entry.heldWithoutS0 ?? "").trim() === "")
    problems.push(`${at}: cites no section of the security design; say why in heldWithoutS0`)
  if (entry.s0.length > 0 && entry.heldWithoutS0 !== undefined)
    problems.push(`${at}: cites a section, so it needs no heldWithoutS0`)
  for (const section of entry.s0)
    if (!contract.sections.includes(section))
      problems.push(`${at}: cites section ${section}, which the security design does not have`)
  if (entry.reason.trim() === "") problems.push(`${at}: say what it carries in reason`)
  if (entry.row === ROOT) {
    if (entry.field === undefined || !contract.rootOptions.includes(entry.field))
      problems.push(`${at}: ${entry.field ?? "(none)"} is not a root option of design 4.1`)
    return problems
  }
  const row = byId.get(entry.row)
  if (entry.rowExists && row === undefined) problems.push(`${at}: names row ${entry.row}, which does not exist`)
  if (!entry.rowExists && row !== undefined) problems.push(`${at}: row ${entry.row} exists now; mark rowExists`)
  if (entry.field === undefined || row === undefined) return problems
  const path = entry.field.split(".")
  if (!hasPath(asNode(row.input), path))
    problems.push(`${at}: ${row.sdk} has no input ${entry.field}; remove the entry`)
  const call = contract.calls[row.sdk]
  if (call !== undefined && hasPath(asNode(call), path))
    problems.push(`${at}: the root type takes ${entry.field} on ${row.sdk}, which P1a holds for P1a-s; remove it`)
  return problems
}

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
  for (const entry of contract.gated) problems.push(...gatedEntryProblems(entry, byId, contract))
  return problems
}

export function inputProblems(rows: readonly Row[], contract: Contract): string[] {
  const problems: string[] = []
  for (const row of p1aRows(rows, contract.gated)) {
    const call = contract.calls[row.sdk]
    if (call === undefined) continue
    const held = heldFields(contract.gated, row.id)
    const own = held.reduce((node, field) => withoutPath(node, field.split(".")), asNode(row.input))
    const rowFields = Object.keys(own.properties ?? {})
    const ahead = (contract.ahead ?? []).filter((entry) => entry.row === row.id).map((entry) => entry.field)
    for (const field of ahead)
      if (rowFields.includes(field))
        problems.push(`row ${row.id}: its descriptor has ${field} now; delete the descriptor-ahead entry`)
    const callFields = Object.keys(call.properties).filter((field) => !ahead.includes(field))
    for (const field of rowFields)
      if (!callFields.includes(field))
        problems.push(`row ${row.id}: input ${field} is missing from the schema of ${row.sdk}`)
    for (const field of callFields)
      if (!rowFields.includes(field))
        problems.push(`row ${row.id}: the schema of ${row.sdk} takes ${field}, which the row lacks`)
    for (const field of rowFields.filter((name) => callFields.includes(name)))
      problems.push(
        ...schemaDifferences(own.properties?.[field], call.properties[field], `row ${row.id} input ${field}`),
      )
    const required = (list: readonly string[]): string => JSON.stringify([...list].toSorted())
    const callRequired = call.required.filter((field) => !ahead.includes(field))
    if (required(own.required ?? []) !== required(callRequired))
      problems.push(
        `row ${row.id}: required is ${required(own.required ?? [])} in the row and ${required(callRequired)} in the schema`,
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
    // A refusal read from the answered value (release's engine reply) is the engine's own error, not an OmoCode.
    const fromValue = scenario.refusal_from === "value"
    if (scenario.refusal === undefined || row === undefined || fromValue) continue
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
  const typed = new Set(p1aRows(rows, contract.gated).map((row) => row.id))
  for (const [code, held] of Object.entries(contract.heldCodes)) {
    if (!sources.has(code)) problems.push(`held code ${code}: not a source code; remove it`)
    if (held.because === "held-rows")
      for (const row of held.rows)
        if (typed.has(row)) problems.push(`held code ${code}: names row ${row}, which P1a types; register the code`)
    if (held.because !== "held-rows" && held.note.trim() === "") problems.push(`held code ${code}: say why in note`)
  }
  return problems
}
