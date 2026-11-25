import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { CallInput } from "./contract-check"
import type { Row } from "./schema"

// Inputs the root's contract types ahead of a row's parity descriptor (design lane ruling on P0's gate, 2026-11-25): a
// call no slice serves yet keeps today's descriptor, and the slice that serves it adds the field there and deletes the
// entry here. One list for every slice; P1a's input check skips a schema field a row lacks only when an entry names it.

export type TypedAheadInput = {
  readonly row: string
  readonly field: string
  readonly reason: string
  readonly retires_with: string
}

export const TYPED_AHEAD_INPUTS: readonly TypedAheadInput[] = (
  JSON.parse(readFileSync(join(import.meta.dir, "typed-ahead-inputs.json"), "utf8")) as {
    entries: TypedAheadInput[]
  }
).entries

export function typedAheadProblems(
  entries: readonly TypedAheadInput[],
  rows: readonly Row[],
  calls: Readonly<Record<string, CallInput>>,
  unresolved: ReadonlySet<string>,
): string[] {
  const problems: string[] = []
  for (const entry of entries) {
    const at = `typed-ahead ${entry.row}.${entry.field}`
    const row = rows.find((candidate) => candidate.id === entry.row)
    if (row === undefined) {
      problems.push(`${at}: no registry row ${entry.row}`)
      continue
    }
    const call = calls[row.sdk]
    if (call === undefined || !Object.hasOwn(call.properties, entry.field))
      problems.push(`${at}: the contract of ${row.sdk} has no input ${entry.field}`)
    if (Object.hasOwn(row.input.properties, entry.field))
      problems.push(`${at}: stale, the row's descriptor carries ${entry.field} now; delete the entry`)
    if (!unresolved.has(entry.row))
      problems.push(`${at}: stale, ${entry.row} has left unresolved.json; delete the entry`)
  }
  return problems
}
