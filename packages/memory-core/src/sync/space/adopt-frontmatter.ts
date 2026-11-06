// Frontmatter adoption per key (sync-design #454 §3), on the item model's kinds: a scalar or
// mapping is a register, a sequence is a set. A register value that differs from the key's
// values is kept as one more whole value (written later as a register entry superseding
// nothing); a set adopts the union of its elements. A value of the other kind converts into the
// key's kind the way §2 converts it (a sequence into a register holds its flow source; a
// register into a set is one element). Nothing is merged, spliced, or written into the body.

import { Buffer } from "node:buffer"

import { renderEntry, type FmEntry } from "../item/frontmatter"
import type { RegisterValue } from "../item/index"

export type AdoptedField =
  | { readonly kind: "reg"; readonly values: string[]; inText: number }
  | { readonly kind: "set"; readonly elements: string[] }

export type AdoptedFields = Map<string, AdoptedField>

/**
 * Seed with the space's own keys. `registers` must hold every register key's exact components:
 * a rendered register is never read as one whole value (review r7 M1), so a missing key throws.
 */
export function seedFields(fields: AdoptedFields, entries: readonly FmEntry[], registers: ReadonlyMap<string, readonly string[]>): void {
  for (const { key, value } of entries) {
    switch (value.kind) {
      case "remove":
        break
      case "set":
        fields.set(key, { kind: "set", elements: [...value.elements] })
        break
      case "reg": {
        const components = registers.get(key)
        if (components === undefined || components.length === 0) {
          throw new Error(`planAdoption: ItemState.registers has no components for register key ${JSON.stringify(key)}`)
        }
        fields.set(key, { kind: "reg", values: [...components], inText: components.length })
        break
      }
    }
  }
}

export function adoptFields(fields: AdoptedFields, entries: readonly FmEntry[]): void {
  for (const { key, value } of entries) {
    if (value.kind === "remove") continue
    const current = fields.get(key)
    if (current === undefined) {
      fields.set(key, value.kind === "set" ? { kind: "set", elements: [...value.elements] } : { kind: "reg", values: [value.value], inText: 1 })
      continue
    }
    switch (current.kind) {
      case "reg":
        addMissing(current.values, [value.kind === "reg" ? value.value : value.flow])
        break
      case "set":
        addMissing(current.elements, value.kind === "set" ? value.elements : [value.value])
        break
    }
  }
}

function addMissing(into: string[], values: readonly string[]): void {
  for (const value of values) if (!into.includes(value)) into.push(value)
}

/** The values beyond those the working text carries: each becomes a register entry superseding nothing. */
export function extraValues(fields: AdoptedFields): RegisterValue[] {
  const out: RegisterValue[] = []
  for (const [key, field] of fields) {
    if (field.kind === "reg") for (const value of field.values.slice(field.inText)) out.push({ key, value })
  }
  return out
}

export function registersOf(fields: AdoptedFields): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [key, field] of fields) if (field.kind === "reg") out.set(key, [...field.values])
  return out
}

/**
 * The item text for these fields. "working" renders each register with only the values the
 * capture writes (the space's own, or a new key's first value); "final" renders every value
 * the way render.ts does: one value verbatim, several as ONE double-quoted string of the
 * distinct sources sorted by UTF-8 bytes and joined with " / ".
 */
export function renderFields(fields: AdoptedFields, body: string, mode: "working" | "final"): string {
  const lines: string[] = []
  for (const [key, field] of fields) {
    if (field.kind === "set") {
      // An empty set holds no element; the item model renders it as nothing (state.ts combineSet).
      if (field.elements.length > 0) lines.push(renderEntry(key, field.elements))
      continue
    }
    const values = mode === "working" ? field.values.slice(0, field.inText) : field.values
    const [sole] = values
    if (values.length === 1 && sole !== undefined) lines.push(renderEntry(key, sole, true))
    else lines.push(renderEntry(key, [...new Set(values)].sort(utf8Compare).join(" / ")))
  }
  return lines.length === 0 ? body : `---\n${lines.join("\n")}\n---\n${body}`
}

function utf8Compare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}
