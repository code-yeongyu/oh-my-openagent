import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { GATED, ROOT_CALLS } from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { callInputOf } from "./call-input"
import { ROWS_DIR } from "./registry"
import type { DomainFile, FieldSchema, Row } from "./schema"

// Types the `input` of every P1a row from the input schema of its root call (slice P1a, #14948), so the row's fields,
// the call's static type and its schema are one value; contract.test.ts fails when they drift. It is contract
// annotation only (design lane ruling, 2026-11-25): it types the fields a row has, their shape, enums and nesting, and
// never adds, drops or renames a field or writes the row's required list; such a difference is P0's row to fix, and the
// input check reports it. A field P1a holds for P1a-s keeps the row's own value, a nested one (`prompt.author`) inside
// the generated field. Run: bun script/sdk-parity/sync-inputs.ts [--check]

type Node = FieldSchema & { readonly anyOf?: readonly Node[] }
type Mutable = { properties?: Record<string, Node>; anyOf?: Node[]; required?: string[] }

// Puts the row's own node at a held nested path back into the generated field, in the union variant that has the parent.
const restore = (target: Node, source: Node | undefined, path: readonly string[]): Node => {
  const [head, ...rest] = path
  if (head === undefined || source === undefined) return target
  const out = { ...target } as Mutable & Node
  if (rest.length === 0) {
    const value = source.properties?.[head]
    if (value !== undefined && out.properties !== undefined)
      out.properties = { ...out.properties, [head]: value as Node }
    if (source.required?.includes(head) === true && out.properties !== undefined)
      out.required = [...new Set([...(out.required ?? []), head])]
  } else if (out.properties?.[head] !== undefined)
    out.properties = {
      ...out.properties,
      [head]: restore(out.properties[head], source.properties?.[head] as Node, rest),
    }
  if (out.anyOf !== undefined) out.anyOf = out.anyOf.map((variant, i) => restore(variant, source.anyOf?.[i], path))
  return out
}

export function syncRow(row: Row): Row {
  const call = (ROOT_CALLS as Readonly<Record<string, { readonly input: unknown }>>)[row.sdk]
  if (call === undefined || row.kind !== "capability") return row
  const schema = callInputOf(call.input) as { properties: Record<string, Node> }
  const held = GATED.filter((entry) => entry.row === row.id && entry.field !== undefined).map(
    (entry) => entry.field ?? "",
  )
  const properties: Record<string, FieldSchema> = {}
  for (const field of Object.keys(row.input.properties)) {
    const generated = schema.properties[field]
    const nested = held.filter((path) => path.startsWith(`${field}.`)).map((path) => path.split(".").slice(1))
    if (held.includes(field) || generated === undefined) properties[field] = row.input.properties[field] ?? {}
    else
      properties[field] = nested.reduce(
        (node, path) => restore(node, row.input.properties[field] as Node, path),
        generated,
      )
  }
  return { ...row, input: { properties, required: row.input.required } }
}

if (import.meta.main) {
  const check = process.argv.includes("--check")
  const stale: string[] = []
  for (const name of readdirSync(ROWS_DIR)
    .filter((file) => file.endsWith(".json"))
    .toSorted()) {
    const path = join(ROWS_DIR, name)
    const text = readFileSync(path, "utf8")
    const file = JSON.parse(text) as DomainFile
    const next = `${JSON.stringify({ ...file, rows: file.rows.map(syncRow) }, null, 2)}\n`
    if (next === text) continue
    stale.push(name)
    if (!check) writeFileSync(path, next)
  }
  if (check && stale.length > 0) {
    console.error(
      `row inputs differ from the root's schemas in: ${stale.join(", ")}; run bun script/sdk-parity/sync-inputs.ts`,
    )
    process.exit(1)
  }
  console.log(check ? "row inputs match the root's schemas" : `rewrote: ${stale.join(", ") || "none"}`)
}
