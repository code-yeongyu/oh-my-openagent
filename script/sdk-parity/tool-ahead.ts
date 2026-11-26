import type { BaselineEntry, ToolAhead } from "./baseline"
import type { Outcome } from "./scenario-run"
import type { Scenario } from "./scenarios"
import type { FieldSchema, Row } from "./schema"
import { schemaDifferences } from "./tool-check"

// A tool ahead of its SDK call under an unresolved gap (LEAD ruling on #15076, 2026-11-26). An unresolved entry that
// carries `toolAhead` admits, in the pull request that adds it and in no later one, exactly: new OPTIONAL tool fields
// named in `fields`, fields named in `widened` whose new schema accepts everything the old one accepted, and declared
// aliases. No property removed, no change to `required`, no other bound moved. Read against the merge base, an entry
// that already carries `toolAhead` admits nothing, so it is never a standing exemption.

type Params = { readonly properties?: Readonly<Record<string, FieldSchema>>; readonly required?: readonly string[] }

export function freshAheadEntries(
  head: readonly BaselineEntry[],
  base: readonly BaselineEntry[] | undefined,
): ReadonlyMap<string, ToolAhead> {
  return new Map(
    head.flatMap((entry) => {
      const ahead = freshAhead(entry, base)
      return ahead === undefined ? [] : [[entry.id, ahead] as const]
    }),
  )
}

// An alias scenario is exempt from the base/head comparison only when the base rows lack what it exercises: its alias,
// or for the field-only scenario, a branch reading the field. A scenario exercising what the base has is compared.
export function aliasNewOnHead(scenario: Scenario, baseRows: ReadonlyMap<string, Row>): boolean {
  if (scenario.surface !== "tool") return false
  const mark = scenario.alias
  if (mark?.field === undefined || mark.row !== scenario.capability) return false
  const row = baseRows.get(mark.row)
  if (row === undefined || !Object.hasOwn(scenario.args, mark.name ?? mark.field)) return false
  const entries = row.tool.filter((entry) => entry.name === scenario.tool)
  if (entries.length === 0) return false
  if (mark.name !== undefined) return !entries.some((entry) => entry.aliases?.[mark.name as string] !== undefined)
  return !entries.some((entry) => entry.reads.includes(mark.field as string))
}

function freshAhead(entry: BaselineEntry | undefined, base: readonly BaselineEntry[] | undefined) {
  if (entry?.toolAhead === undefined) return undefined
  const before = base?.find((candidate) => candidate.id === entry.id)
  return before?.toolAhead === undefined ? entry.toolAhead : undefined
}

const sorted = (list: readonly string[] | undefined): string => JSON.stringify([...(list ?? [])].toSorted())

// The new bound accepts every value the old one did: a lower minimum, a higher or absent maximum.
function widens(before: FieldSchema, after: FieldSchema, path: string): string[] {
  const a = before as Record<string, unknown>
  const b = after as Record<string, unknown>
  const lower = (key: string) =>
    b[key] === undefined || (typeof a[key] === "number" && (b[key] as number) <= (a[key] as number))
  const upper = (key: string) =>
    b[key] === undefined || (a[key] !== undefined && (b[key] as number) >= (a[key] as number))
  const problems: string[] = []
  for (const key of ["minimum", "minLength", "minItems"]) if (!lower(key)) problems.push(`${path}: ${key} narrowed`)
  for (const key of ["maximum", "maxLength", "maxItems"]) if (!upper(key)) problems.push(`${path}: ${key} narrowed`)
  const rest = (value: Record<string, unknown>) => {
    const { minimum, minLength, minItems, maximum, maxLength, maxItems, description, ...other } = value
    return other
  }
  problems.push(...schemaDifferences(rest(a), rest(b), path))
  return problems
}

export function toolSchemaAheadProblems(before: Params, after: Params, ahead: ToolAhead, tool: string): string[] {
  const problems: string[] = []
  const { properties: _p, required: _r, ...beforeRest } = before as Record<string, unknown>
  const { properties: _q, required: _s, ...afterRest } = after as Record<string, unknown>
  problems.push(...schemaDifferences(beforeRest, afterRest, tool))
  for (const key of ahead.widened ?? []) {
    if (before.properties?.[key] === undefined) problems.push(`${tool}.${key}: widened but not on the base`)
    else if (after.properties?.[key] === undefined) problems.push(`${tool}.${key}: removed`)
  }
  if (sorted(before.required) !== sorted(after.required)) problems.push(`${tool}: required changed`)
  const [a, b] = [before.properties ?? {}, after.properties ?? {}]
  for (const key of Object.keys(a)) {
    const next = b[key]
    if (next === undefined) problems.push(`${tool}.${key}: removed`)
    else if (ahead.widened?.includes(key) === true)
      problems.push(...widens(a[key] as FieldSchema, next, `${tool}.${key}`))
    else problems.push(...schemaDifferences(a[key], next, `${tool}.${key}`))
  }
  for (const key of Object.keys(b))
    if (a[key] === undefined && ahead.fields?.includes(key) !== true)
      problems.push(`${tool}.${key}: added but not listed`)
  return problems
}

export function descriptorAheadProblems(before: Row, after: Row, ahead: ToolAhead): string[] {
  const problems: string[] = []
  const at = after.id
  const listed = new Set(ahead.fields ?? [])
  if (sorted(before.input.required) !== sorted(after.input.required)) problems.push(`${at}: required changed`)
  for (const name of Object.keys(before.input.properties))
    if (after.input.properties[name] === undefined) problems.push(`${at}: input ${name} removed`)
    else if (
      listed.has(name) &&
      !after.tool.some(
        (entry) =>
          entry.reads.includes(name) &&
          !before.tool.some(
            (old) => old.name === entry.name && old.branch === entry.branch && old.reads.includes(name),
          ),
      )
    )
      problems.push(`${at}: listed field ${name} already exists on the base and no branch newly reads it`)
  for (const name of listed)
    if (after.input.required.includes(name)) problems.push(`${at}: listed field ${name} is required`)
  for (const old of before.tool) {
    const next = after.tool.find((entry) => entry.name === old.name && entry.branch === old.branch)
    if (next === undefined) {
      problems.push(`${at}: tool ${old.name} branch ${old.branch} removed`)
      continue
    }
    for (const name of old.reads)
      if (!next.reads.includes(name)) problems.push(`${at}: ${old.name}/${old.branch} no longer reads ${name}`)
    for (const [alias, field] of Object.entries(old.aliases ?? {}))
      if (next.aliases?.[alias] !== field)
        problems.push(`${at}: ${old.name}/${old.branch} alias ${alias} removed or remapped`)
  }
  if (ahead.aliases !== true)
    for (const entry of after.tool)
      for (const alias of Object.keys(entry.aliases ?? {}))
        if (
          before.tool.find((old) => old.name === entry.name && old.branch === entry.branch)?.aliases?.[alias] ===
          undefined
        )
          problems.push(`${at}: alias ${alias} added without aliases: true`)
  return problems
}

export function withoutAhead(row: Row, ahead: ToolAhead): Row {
  const fields = new Set(ahead.fields ?? [])
  return {
    ...row,
    input: {
      properties: Object.fromEntries(Object.entries(row.input.properties).filter(([name]) => !fields.has(name))),
      required: row.input.required,
    },
    tool: row.tool.map(({ aliases, ...entry }) => ({
      ...entry,
      reads: entry.reads.filter((name) => !fields.has(name)),
      ...(ahead.aliases === true || aliases === undefined ? {} : { aliases }),
    })),
  }
}

export function aliasScenarioProblems(
  scenarios: readonly Scenario[],
  outcomes: Readonly<Record<string, Outcome>>,
): string[] {
  const problems: string[] = []
  for (const scenario of scenarios) {
    if (scenario.surface !== "tool" || scenario.alias === undefined) continue
    const outcome = outcomes[scenario.id]
    if (scenario.alias.twin !== undefined && JSON.stringify(outcome) !== JSON.stringify(outcomes[scenario.alias.twin]))
      problems.push(
        `${scenario.capability}: alias scenario ${scenario.id} answers differently from ${scenario.alias.twin}`,
      )
    const code = (outcome as { result?: { error?: { code?: string } } } | undefined)?.result?.error?.code
    if (scenario.alias.conflict === true && code !== "invalid_arguments")
      problems.push(
        `${scenario.capability}: alias scenario ${scenario.id} must be refused invalid_arguments, got ${code}`,
      )
  }
  return problems
}
