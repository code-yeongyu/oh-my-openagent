// The parity registry's row schema (design section 7.2). A row is one leaf capability of section 6 in both editions;
// `sdk` is required for every row, so an SDK omission cannot be written down.

export const EDITIONS = ["native", "opencode"] as const
export type Edition = (typeof EDITIONS)[number]

export const ROW_KINDS = ["capability", "reserved", "internal", "retired", "render"] as const
export type RowKind = (typeof ROW_KINDS)[number]

export const SDK_TODAY = ["yes", "partial", "no"] as const
export type SdkToday = (typeof SDK_TODAY)[number]

// How a route reaches its implementation today: the launcher's own tables, the engine it forwards argv to, a Commander
// program, or the delegated loop component.
export const VIAS = ["launcher", "engine", "commander", "loop"] as const
export type Via = (typeof VIAS)[number]

// The root options of design 4.1 that a CLI flag may fill instead of a call input.
export const ROOT_OPTIONS = ["api", "accounts", "env", "cwd", "home", "agentDir", "uid", "user", "endpoint", "platform"] as const

// A flag or positional fills one SDK input field (`field`, `field=value`, `field.nested`), a root option (`root.<name>`),
// or is not an input: `render` (output shape), `process` (the CLI process itself), `when` (selects this branch).
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
}

// One rendered row of a section 6 table: which capabilities it stands for and its cells exactly as published.
export type TableEntry = {
  readonly table: string
  readonly position: number
  readonly ids: readonly string[]
  readonly cells: readonly string[]
}

export type DomainFile = { readonly domain: string; readonly rows: readonly Row[]; readonly tables: readonly TableEntry[] }

const fieldOf = (target: Target): string => target.split(/[.=]/)[0] ?? target

/** Every rule a row must satisfy on its own; each message names the row and the field or flag to fix. */
export function rowProblems(row: Row): string[] {
  const problems: string[] = []
  const at = `row ${row.id}`
  if (row.sdk.trim() === "") problems.push(`${at}: sdk is required; name the SDK call this capability has`)
  if (row.kind === "reserved" && (row.cli.length > 0 || row.tool.length > 0))
    problems.push(`${at}: a reserved name has no CLI or tool surface`)
  for (const surface of ["cli", "tool"] as const) {
    const empty = row[surface].length === 0
    const planned = row.planned[surface] !== undefined
    const omitted = row.omitted[surface] !== undefined
    if (planned && omitted) problems.push(`${at}: ${surface} is both planned and omitted; it is one or the other`)
    if (row.kind === "capability" && empty && !planned && !omitted)
      problems.push(`${at}: empty ${surface} needs planned (a slice) or omitted (a reason)`)
  }
  const inputs = new Set(Object.keys(row.input.properties))
  const checkTarget = (where: string, target: Target): void => {
    if (target === "render" || target === "process" || target === "when") return
    if (target.startsWith("root.")) {
      const option = target.slice("root.".length).split(/[.=]/)[0] ?? ""
      if (!(ROOT_OPTIONS as readonly string[]).includes(option))
        problems.push(`${at}: ${where} fills root option "${option}", which the SDK root does not have`)
      return
    }
    if (!inputs.has(fieldOf(target)))
      problems.push(`${at}: ${where} fills "${fieldOf(target)}", which ${row.sdk} does not take; add it to the SDK input`)
  }
  for (const entry of row.cli) {
    const verb = `${entry.edition} "${entry.route.join(" ")}"`
    for (const [flag, target] of Object.entries(entry.flags)) checkTarget(`${verb} flag ${flag}`, target)
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
