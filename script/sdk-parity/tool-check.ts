import type { FieldSchema, Row } from "./schema"

// Tools are a subset of the SDK (design 7.2): every tool a test engine session registers has a row, every tool input field is read by one
// of that tool's branches, and each branch's fields are compared recursively with the SDK call's input: every
// property, nested object, optionality, bound and default. A declared projection is the only accepted difference.
// Descriptions are prose and are not compared.

export type DiscoveredTool = {
  readonly name: string
  readonly parameters: { readonly properties?: Readonly<Record<string, FieldSchema>>; readonly required?: readonly string[] }
}

// Names a run-time declaration fills (`ext_<extension>_<tool>`): checked where they are declared, not here.
const isPattern = (name: string): boolean => name.includes("<")

const COMPARED = [
  "type",
  "const",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "default",
  "additionalProperties",
] as const

export function schemaDifferences(tool: unknown, sdk: unknown, path: string): string[] {
  if (typeof tool !== "object" || tool === null || typeof sdk !== "object" || sdk === null)
    return JSON.stringify(tool) === JSON.stringify(sdk) ? [] : [`${path}: tool ${JSON.stringify(tool)}, SDK ${JSON.stringify(sdk)}`]
  const a = tool as Record<string, unknown>
  const b = sdk as Record<string, unknown>
  const out: string[] = []
  for (const key of COMPARED)
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      out.push(`${path}: ${key} is ${JSON.stringify(a[key])} in the tool and ${JSON.stringify(b[key])} in the SDK`)
  const required = (value: unknown): string => JSON.stringify([...((value as string[] | undefined) ?? [])].toSorted())
  if (required(a.required) !== required(b.required))
    out.push(`${path}: required is ${required(a.required)} in the tool and ${required(b.required)} in the SDK`)
  const props = (value: unknown): Record<string, unknown> => (value as Record<string, unknown> | undefined) ?? {}
  const keys = new Set([...Object.keys(props(a.properties)), ...Object.keys(props(b.properties))])
  for (const key of [...keys].toSorted()) out.push(...schemaDifferences(props(a.properties)[key], props(b.properties)[key], `${path}.${key}`))
  if (a.items !== undefined || b.items !== undefined) out.push(...schemaDifferences(a.items, b.items, `${path}[]`))
  const variants = (value: unknown): unknown[] => (value as unknown[] | undefined) ?? []
  const [left, right] = [variants(a.anyOf), variants(b.anyOf)]
  if (left.length !== right.length) out.push(`${path}: ${left.length} variants in the tool and ${right.length} in the SDK`)
  else left.forEach((variant, i) => out.push(...schemaDifferences(variant, right[i], `${path}|${i}`)))
  return out
}

export function toolProblems(discovered: readonly DiscoveredTool[], rows: readonly Row[]): string[] {
  const problems: string[] = []
  const branches = rows.flatMap((row) => row.tool.map((entry) => ({ row, entry })))
  const byName = new Map(discovered.map((tool) => [tool.name, tool]))
  for (const tool of discovered) {
    const own = branches.filter(({ entry }) => entry.name === tool.name)
    if (own.length === 0) {
      problems.push(`tool ${tool.name} has no row; add the SDK call it reaches and a tool entry naming it`)
      continue
    }
    const read = new Set(own.flatMap(({ entry }) => entry.reads))
    for (const field of Object.keys(tool.parameters.properties ?? {}))
      if (!read.has(field)) problems.push(`tool ${tool.name} input field "${field}" is in no SDK call; add it to the call's input`)
    for (const { row, entry } of own)
      for (const field of entry.reads) {
        const sdkField = row.projection[field] ?? field
        const path = `tool ${tool.name} (${entry.branch} -> ${row.sdk}) field ${field}`
        problems.push(...schemaDifferences(tool.parameters.properties?.[field], row.input.properties[sdkField], path))
        const toolRequired = tool.parameters.required?.includes(field) === true
        if (toolRequired !== row.input.required.includes(sdkField))
          problems.push(`${path}: ${toolRequired ? "required" : "optional"} in the tool, not in ${row.sdk}`)
      }
  }
  for (const { row, entry } of branches)
    if (!isPattern(entry.name) && !byName.has(entry.name))
      problems.push(`row ${row.id} names tool ${entry.name}, which the session does not register; remove the entry`)
  return problems
}
