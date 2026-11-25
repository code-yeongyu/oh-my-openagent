import { scopeProblems } from "./row-scopes"

// The parity registry's row schema (design section 7.2). A row is one leaf capability of section 6 in both editions;
// `sdk` is required for every row, so an SDK omission cannot be written down.

const EDITIONS = ["native", "opencode"] as const
export type Edition = (typeof EDITIONS)[number]

const ROW_KINDS = ["capability", "reserved", "internal", "retired", "render"] as const
export type RowKind = (typeof ROW_KINDS)[number]

const SDK_TODAY = ["yes", "partial", "no"] as const
export type SdkToday = (typeof SDK_TODAY)[number]

// How a route reaches its implementation today: the launcher's own tables, the engine it forwards argv to, a Commander
// program, or the delegated loop component.
const VIAS = ["launcher", "engine", "commander", "loop"] as const
export type Via = (typeof VIAS)[number]

// The root options of design 4.1 that a CLI flag may fill instead of a call input.
const ROOT_OPTIONS = [
  "api",
  "accounts",
  "env",
  "cwd",
  "home",
  "agentDir",
  "uid",
  "user",
  "endpoint",
  "platform",
] as const

// A flag or positional fills one SDK input field (`field`, `field=value`, `field.nested`), a root option (`root.<name>`),
// or is not an input: `render` (output shape), `process` (the CLI process itself), `when` (selects this branch),
// `parse` (read only by the adapter's parser; the entry's `parseOnly` gives the written reason).
export type Target = string

export type FieldSchema = {
  readonly type?: string | readonly string[]
  readonly enum?: readonly (string | number | boolean)[]
  readonly items?: FieldSchema
  readonly properties?: Readonly<Record<string, FieldSchema>>
  readonly required?: readonly string[]
  readonly anyOf?: readonly FieldSchema[]
  readonly minimum?: number
  readonly maximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
  readonly default?: unknown
}

export type InputSchema = {
  readonly properties: Readonly<Record<string, FieldSchema>>
  readonly required: readonly string[]
}

export type CliEntry = {
  readonly edition: Edition
  readonly via: Via
  readonly route: readonly string[]
  readonly flags: Readonly<Record<string, Target>>
  readonly positionals: Readonly<Record<string, Target>>
  readonly values: readonly string[]
  readonly parseOnly?: Readonly<Record<string, string>>
}

export type ToolEntry = {
  readonly name: string
  readonly branch: string
  readonly when: { readonly present: readonly string[]; readonly absent: readonly string[] }
  readonly reads: readonly string[]
}

export type Surfaces = { readonly cli?: string; readonly tool?: string }

export type Row = {
  readonly id: string
  readonly kind: RowKind
  readonly sdk: string
  readonly today: SdkToday
  readonly slices: readonly string[]
  readonly input: InputSchema
  readonly cli: readonly CliEntry[]
  readonly tool: readonly ToolEntry[]
  readonly planned: Surfaces
  readonly omitted: Surfaces
  readonly projection: Readonly<Record<string, string>>
  readonly scenarios: { readonly effect: readonly string[]; readonly refusal: readonly string[] }
  readonly modules: readonly string[]
  readonly note?: string
  /** Host-local (design 7.3): the call acts on the calling device's session host only. Closed list: HOST_LOCAL_ROWS. */
  readonly addressScope?: "this_device"
  readonly addressReason?: string
  /** Pure (design 7.3): the call touches no port at all; its answer builds it. Closed list: PURE_ROWS. */
  readonly pure?: true
  readonly pureReason?: string
}

// One rendered row of a section 6 table: which capabilities it stands for and its cells exactly as published.
export type TableEntry = {
  readonly table: string
  // A pointer names rows described in another table (6.8's Host sessions, 6.11's account and loop rows).
  readonly kind?: "pointer"
  readonly position: number
  readonly ids: readonly string[]
  readonly cells: readonly string[]
}

export type DomainFile = {
  readonly domain: string
  readonly rows: readonly Row[]
  readonly tables: readonly TableEntry[]
}

// The slices of design section 8; a planned surface or a row's slice names one of them.
export const SLICES = new Set([
  "S0",
  "P0",
  "P1a",
  "P1a-s",
  "P1b",
  "T1a",
  "T1b",
  "T1c",
  "T1d",
  "T1e",
  "D1",
  "T2",
  "T3",
  "A1a",
  "A1b",
  "A1c",
  "A1d",
  "A2a",
  "A2b",
  "A2c",
  "C1a",
  "C1b",
  "C1c",
  "TEL",
  "E1a",
  "E1a-s",
  "E1b",
  "E1c",
  "X1a",
  "NM",
  "OC1a",
  "OC1b",
  "OC1c",
  "OC2",
  "X1c",
  "X1b",
  "X2",
  "shipped",
  "reserved",
])

const fieldOf = (target: Target): string => target.split(/[.=]/)[0] ?? target

// The schema at a dotted path (`worktree.branch`), or undefined when any segment is missing.
export function schemaAt(input: InputSchema, path: string): FieldSchema | undefined {
  const [head, ...rest] = path.split(".")
  let schema: FieldSchema | undefined = input.properties[head ?? ""]
  for (const segment of rest)
    schema =
      schema?.properties?.[segment] ??
      schema?.anyOf?.map((variant) => variant.properties?.[segment]).find((found) => found !== undefined)
  return schema
}

const allowedValues = (schema: FieldSchema): readonly unknown[] | undefined => {
  if (schema.enum !== undefined) return schema.enum
  if (schema.type === "boolean") return [true, false]
  const consts = (schema.anyOf ?? []).map((variant) => Reflect.get(variant, "const"))
  return consts.length > 0 && consts.every((value) => value !== undefined) ? consts : undefined
}

/** Every rule a row must satisfy on its own; each message names the row and the field or flag to fix. */
export function rowProblems(row: Row): string[] {
  const problems: string[] = []
  const at = `row ${row.id}`
  if (row.sdk.trim() === "") problems.push(`${at}: sdk is required; name the SDK call this capability has`)
  problems.push(...scopeProblems(row))
  if (row.kind === "reserved" && (row.cli.length > 0 || row.tool.length > 0))
    problems.push(`${at}: a reserved name has no CLI or tool surface`)
  for (const surface of ["cli", "tool"] as const) {
    const empty = row[surface].length === 0
    const plannedSlice = row.planned[surface]
    const reason = row.omitted[surface]
    const planned = plannedSlice !== undefined
    const omitted = reason !== undefined
    if (plannedSlice !== undefined && !SLICES.has(plannedSlice))
      problems.push(`${at}: planned ${surface} names "${plannedSlice}", which is not a slice of design section 8`)
    if (reason !== undefined && reason.trim().length < 12)
      problems.push(`${at}: omitted ${surface} needs a written reason, not "${reason}"`)
    if (planned && omitted) problems.push(`${at}: ${surface} is both planned and omitted; it is one or the other`)
    if (row.kind === "capability" && empty && !planned && !omitted)
      problems.push(`${at}: empty ${surface} needs planned (a slice) or omitted (a reason)`)
  }
  const inputs = new Set(Object.keys(row.input.properties))
  const checkTarget = (where: string, target: Target): void => {
    if (target === "render" || target === "process" || target === "when") return
    if (target === "parse") {
      if (parseReason === undefined)
        problems.push(`${at}: ${where} is a parse flag with no written reason in parseOnly`)
      return
    }
    if (target.startsWith("root.")) {
      const option = target.slice("root.".length).split(/[.=]/)[0] ?? ""
      if (!(ROOT_OPTIONS as readonly string[]).includes(option))
        problems.push(`${at}: ${where} fills root option "${option}", which the SDK root does not have`)
      return
    }
    if (!inputs.has(fieldOf(target))) {
      problems.push(
        `${at}: ${where} fills "${fieldOf(target)}", which ${row.sdk} does not take; add it to the SDK input`,
      )
      return
    }
    const [path = "", value] = target.split("=")
    const schema = schemaAt(row.input, path)
    if (schema === undefined) {
      problems.push(`${at}: ${where} fills "${path}", a path ${row.sdk}'s input does not have; add the nested field`)
      return
    }
    const allowed = allowedValues(schema)
    // A presence flag that creates an object field (`--worktree`) writes `=true`: the object exists, its children filled
    // by other flags.
    const createsObject = value === "true" && (schema.type === "object" || schema.properties !== undefined)
    // A value flag cannot fill a boolean field: the parser would read the next word as its value (review 6061874518 M4).
    if (value === undefined && where.includes(" flag ") && schema.type === "boolean")
      problems.push(
        `${at}: ${where} takes a value but fills ${path}, a boolean; write it as ${path}=true if it is a presence flag`,
      )
    if (value !== undefined && allowed === undefined && !createsObject)
      problems.push(`${at}: ${where} sets ${path} to "${value}", but its schema lists no allowed values; declare them`)
    if (value !== undefined && allowed !== undefined && !allowed.map(String).includes(value))
      problems.push(
        `${at}: ${where} sets ${path} to "${value}", which its schema does not allow (${allowed.join(", ")})`,
      )
  }
  for (const slice of row.slices)
    if (!SLICES.has(slice)) problems.push(`${at}: slice "${slice}" is not a slice of design section 8`)
  let parseReason: string | undefined
  for (const entry of row.cli) {
    const verb = `${entry.edition} "${entry.route.join(" ")}"`
    for (const [flag, target] of Object.entries(entry.flags)) {
      parseReason = entry.parseOnly?.[flag]
      checkTarget(`${verb} flag ${flag}`, target)
    }
    parseReason = undefined
    for (const [name, target] of Object.entries(entry.positionals)) checkTarget(`${verb} <${name}>`, target)
  }
  for (const tool of row.tool)
    for (const field of tool.reads)
      if (!inputs.has(field)) problems.push(`${at}: tool ${tool.name} reads "${field}", which ${row.sdk} does not take`)
  return problems
}

export function registryProblems(files: readonly DomainFile[]): string[] {
  const problems: string[] = []
  const ids = new Map<string, string>()
  for (const file of files)
    for (const row of file.rows) {
      const owner = ids.get(row.id)
      if (owner !== undefined) problems.push(`row ${row.id}: defined in both ${owner} and ${file.domain}`)
      ids.set(row.id, file.domain)
      problems.push(...rowProblems(row))
    }
  for (const file of files)
    for (const entry of file.tables)
      for (const id of entry.ids)
        if (!ids.has(id)) problems.push(`table ${entry.table} in ${file.domain}: names row ${id}, which does not exist`)
  return problems
}
