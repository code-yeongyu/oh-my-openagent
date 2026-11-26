import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { FreeField } from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { REPO_ROOT } from "./registry"

// Slice P1a-s (#14949): omo's engine.auth.check contract against the engine's own, which omo cannot import until its
// engine pin carries it (design lane ruling on review 6062824873). The snapshot is a copy of the engine's exports at one
// named commit; these checks map it to omo's table and session answer in both directions, and the awaiting check fails
// the day the pinned engine exports the contract, which forces deleting the snapshot and importing the real thing.

export type EngineFreeField = FreeField & { readonly call: string }
export type EngineSnapshot = {
  readonly source: { readonly repo: string; readonly pull_request: number; readonly commit: string }
  readonly free_fields: readonly EngineFreeField[]
  readonly check_codes: readonly string[]
  readonly session_answer: Readonly<Record<string, string | readonly string[]>>
  readonly session_required: readonly string[]
}

const SNAPSHOT_PATH = join(REPO_ROOT, "script/sdk-parity/engine-snapshot/auth-check-56cddc3b81.json")
export const loadSnapshot = (): EngineSnapshot => JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as EngineSnapshot

/** The engine's field notation (`value.accounts.[].email`, `provider_text.*`) in omo's (`accounts[].email`). */
const omoPath = (field: string): string => field.replace(/^value\./, "").replace(/\.\[\]/g, "[]")

const covers = (pattern: string, field: string): boolean =>
  pattern.endsWith(".*") ? field.startsWith(pattern.slice(0, -1)) : pattern === field

export function freeFieldMappingProblems(engine: readonly EngineFreeField[], omo: readonly FreeField[]): string[] {
  const problems: string[] = []
  const same = (a: FreeField, b: FreeField): boolean => a.origin === b.origin && a.may_embed === b.may_embed
  for (const entry of engine) {
    const pattern = omoPath(entry.field)
    const matched = omo.filter((field) => covers(pattern, field.field))
    if (matched.length === 0) problems.push(`engine ${entry.call} ${entry.field}: no omo field maps to it`)
    for (const field of matched)
      if (!same(field, entry))
        problems.push(
          `engine ${entry.call} ${entry.field}: omo ${field.field} is ${field.origin}/${field.may_embed}, the engine says ${entry.origin}/${entry.may_embed}`,
        )
  }
  for (const field of omo)
    if (!engine.some((entry) => covers(omoPath(entry.field), field.field)))
      problems.push(`omo ${field.field}: no entry of the engine's table maps to it`)
  return problems
}

type SchemaNode = {
  readonly properties?: Readonly<Record<string, SchemaNode>>
  readonly required?: readonly string[]
  readonly items?: SchemaNode
  readonly anyOf?: readonly SchemaNode[]
  readonly enum?: readonly string[]
  readonly const?: string
  readonly type?: string
}

// The leaves of omo's session schema as the snapshot writes them: a closed set as its values, otherwise the type.
function leaves(
  node: SchemaNode,
  path: string,
  out: Map<string, string | readonly string[]>,
  required: string[],
): void {
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    const at = path === "" ? name : `${path}.${name}`
    if (node.required?.includes(name) === true) required.push(at)
    if (child.items !== undefined) {
      leaves(child.items, `${at}[]`, out, required)
      continue
    }
    const values =
      child.enum ??
      child.anyOf?.flatMap((variant) => variant.enum ?? (variant.const === undefined ? [] : [variant.const]))
    out.set(at, values !== undefined && values.length > 0 ? values : (child.type ?? "unknown"))
  }
}

export function sessionShapeProblems(snapshot: EngineSnapshot, sessionSchema: unknown): string[] {
  const session = sessionSchema as SchemaNode
  const problems: string[] = []
  const omo = new Map<string, string | readonly string[]>()
  const required: string[] = []
  leaves(session, "", omo, required)
  const expand = (value: string | readonly string[]): string =>
    JSON.stringify(
      typeof value === "string"
        ? value
        : value.flatMap((v) => (v === "AuthAccountCheckCode" ? snapshot.check_codes : [v])),
    )
  for (const [path, value] of Object.entries(snapshot.session_answer)) {
    const mine = omo.get(path)
    if (mine === undefined) problems.push(`engine session ${path}: omo's session answer has no such field`)
    else if (expand(mine) !== expand(value))
      problems.push(`engine session ${path}: omo has ${expand(mine)}, the engine ${expand(value)}`)
  }
  for (const path of omo.keys())
    if (!(path in snapshot.session_answer))
      problems.push(`omo session ${path}: the engine's session answer has no such field`)
  const want = JSON.stringify([...snapshot.session_required].toSorted())
  const have = JSON.stringify(required.toSorted())
  if (want !== have) problems.push(`session required fields: omo ${have}, the engine ${want}`)
  return problems
}

/** Whether omo's pinned engine package exports the engine contract the snapshot copies. */
export function pinnedEngineExportsContract(exportsField: Readonly<Record<string, unknown>>): boolean {
  return Object.hasOwn(exportsField, "./engine")
}
