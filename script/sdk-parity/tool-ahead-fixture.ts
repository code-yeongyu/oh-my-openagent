import type { BaselineEntry } from "./baseline"
import { gateReport } from "./gate"
import { input, rows, unresolved } from "./gate-fixture"
import type { FieldSchema, Row } from "./schema"

// Shared inputs of the tool-ahead negative controls (LEAD ruling on #15076): the real rows and manifest, the merge base
// rolled back to what each entry lists, and one gate run per kind of change.

export const withoutAhead = (entries: readonly BaselineEntry[]): BaselineEntry[] =>
  entries.map(({ toolAhead: _ahead, ...entry }) => entry)
export const tool = (name: string, properties: Record<string, FieldSchema>) => [{ name, parameters: { properties } }]
export const run = (
  name: string,
  before: Record<string, FieldSchema>,
  after: Record<string, FieldSchema>,
  base: readonly BaselineEntry[] = withoutAhead(unresolved.entries),
) =>
  gateReport(
    input({
      base: { ...input().base, tools: tool(name, before), unresolved: base },
      head: { ...input().head, tools: tool(name, after) },
    }),
  )
export const named = (failures: readonly string[], tool: string) =>
  failures.filter((line) => line.includes(`tool ${tool} `))
export const runParams = (name: string, before: object, after: object) =>
  gateReport(
    input({
      base: { ...input().base, tools: [{ name, parameters: before }], unresolved: withoutAhead(unresolved.entries) },
      head: { ...input().head, tools: [{ name, parameters: after }] },
    }),
  )
export const state = { type: "array", items: { anyOf: [{ type: "string", const: "idle" }] } }
// The merge base as the entries describe it: each row without the fields its entry lists and without aliases.
const listedOf = (id: string) => new Set(unresolved.entries.find((entry) => entry.id === id)?.toolAhead?.fields ?? [])
export const baseRows = rows.map((row): Row => {
  const listed = listedOf(row.id)
  return {
    ...row,
    input: {
      ...row.input,
      properties: Object.fromEntries(Object.entries(row.input.properties).filter(([name]) => !listed.has(name))),
    },
    tool: row.tool.map(({ aliases: _aliases, ...entry }) => ({
      ...entry,
      reads: entry.reads.filter((name) => !listed.has(name)),
    })),
  }
})
export const rowReport = (id: string, edit: (row: Row) => Row) =>
  gateReport(
    input({
      base: { ...input().base, rows: baseRows, unresolved: withoutAhead(unresolved.entries) },
      head: { ...input().head, rows: rows.map((row) => (row.id === id ? edit(row) : row)) },
    }),
  )
export const rowFailures = (id: string, edit: (row: Row) => Row) =>
  rowReport(id, edit).failures.filter((line) => line.startsWith(`${id}: its descriptor changed`))
export const file = (row: Row) => [{ domain: "threads", rows: [row], tables: [] }]
export const list = rows.find((row) => row.id === "threads.list") as Row
export const withAliasesOnBase = baseRows.map((row): Row => {
  const head = rows.find((candidate) => candidate.id === row.id) as Row
  return {
    ...row,
    tool: row.tool.map((entry, i) => ({
      ...entry,
      ...(head.tool[i]?.aliases === undefined ? {} : { aliases: head.tool[i]?.aliases }),
    })),
  }
})
