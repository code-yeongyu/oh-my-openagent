// Current per-key container contents and their combination under the kind rule
// (sync-design §2, spec #454): a key's kind (register or set) is fixed by its earliest
// first-write op, and content in the container of the other kind is converted into that kind
// without changing its YAML type. A register is multi-value: concurrent writes all stay active
// until a write that saw them supersedes them; registerValues is the one place that decides how
// active entries resolve. Every stored value is a canonical YAML source (one self-contained
// line, frontmatter.ts renderScalar); render.ts turns sources into YAML nodes.

import { Buffer } from "node:buffer"

import type { ContainerID, ContainerType, LoroDoc } from "../../crdt/loro-runtime"

import { parseDocument, isScalar } from "yaml"

import { renderScalar, sequenceElements } from "./frontmatter"
import type { FmPart, ItemHistory, KeyHistory, Stamp } from "./history"

export const BODY_NAME = "body"
export const TOMBSTONES_NAME = "tombstones"

export function fmName(key: string, part: FmPart): string {
  // Root names cannot contain "/" (Loro rejects it), so the §2 `fm/<key>/<part>`
  // grammar is written with the unit separator; the encoded key never contains it.
  return `fm\x1f${encodeURIComponent(key)}\x1f${part}`
}

export function cidRoot(name: string, type: ContainerType): ContainerID {
  return `cid:root-${name}:${type}`
}

export interface RegEntry {
  readonly tag: string
  readonly value: string | null
  readonly supersedes: readonly string[]
}

export interface KeyState {
  readonly set: readonly { readonly tag: string; readonly element: string }[]
  readonly reg: readonly RegEntry[]
}

export function readKeyState(doc: LoroDoc, key: string): KeyState {
  const set: { tag: string; element: string }[] = []
  if (doc.hasContainer(cidRoot(fmName(key, "set"), "Map"))) {
    for (const [tag, value] of doc.getMap(fmName(key, "set")).entries()) {
      if (typeof value === "string") set.push({ tag, element: value })
    }
  }
  const reg: RegEntry[] = []
  if (doc.hasContainer(cidRoot(fmName(key, "reg"), "Map"))) {
    for (const [tag, value] of doc.getMap(fmName(key, "reg")).entries()) {
      const entry = asRegEntry(tag, value)
      if (entry !== null) reg.push(entry)
    }
  }
  return { set, reg }
}

function asRegEntry(tag: string, value: unknown): RegEntry | null {
  if (typeof value !== "object" || value === null) return null
  if (!("v" in value) || !("s" in value)) return null
  const v = value.v
  const s = value.s
  if (v !== null && typeof v !== "string") return null
  if (!Array.isArray(s) || s.some((t) => typeof t !== "string")) return null
  return { tag, value: v, supersedes: s as readonly string[] }
}

/** The register rule: every active entry's whole value, one per distinct value. */
export function registerValues(entries: readonly RegEntry[]): string[] {
  return [...new Set(activeReg(entries).map((entry) => entry.value))]
}

export function activeReg(entries: readonly RegEntry[]): (RegEntry & { readonly value: string })[] {
  const superseded = new Set(entries.flatMap((entry) => entry.supersedes))
  return entries.filter(
    (entry): entry is RegEntry & { readonly value: string } => entry.value !== null && !superseded.has(entry.tag),
  )
}

const MISSING_STAMP: Stamp = { lamport: Number.MAX_SAFE_INTEGER, peer: "0" }

/**
 * Bare text of a stored register value: strip one renderScalar layer when it quotes.
 * Used only where a register's text joins other content into one plain value.
 */
export function regText(value: string): string {
  const doc = parseDocument(value, { schema: "core" })
  if (doc.errors.length > 0) return value
  const contents = doc.contents
  if (contents === null || !isScalar(contents)) return value
  const parsed: unknown = contents.value
  return typeof parsed === "string" ? parsed : value
}


function stampCompare(a: Stamp, b: Stamp): number {
  if (a.lamport !== b.lamport) return a.lamport - b.lamport
  const pa = BigInt(a.peer)
  const pb = BigInt(b.peer)
  return pa < pb ? -1 : pa > pb ? 1 : 0
}

function addStamp(history: ItemHistory, key: string, part: "set" | "reg", tag: string, fallback: Stamp | undefined): Stamp {
  const book = part === "set" ? history.setAdds : history.regAdds
  return book.get(key)?.get(tag) ?? fallback ?? MISSING_STAMP
}

export function orderedSetElements(state: KeyState, key: string, history: ItemHistory): string[] {
  const fallback = history.keys.get(key)?.byKind.get("set")
  const tagged = state.set.map(({ tag, element }) => ({
    element,
    stamp: addStamp(history, key, "set", tag, fallback),
  }))
  tagged.sort((a, b) => stampCompare(a.stamp, b.stamp) || (a.element < b.element ? -1 : a.element > b.element ? 1 : 0))
  const seen = new Set<string>()
  const out: string[] = []
  for (const { element } of tagged) {
    if (seen.has(element)) continue
    seen.add(element)
    out.push(element)
  }
  return out
}

export type CombinedValue =
  | { readonly kind: "reg"; readonly text: string; readonly verbatim: boolean }
  | { readonly kind: "set"; readonly elements: readonly string[] }

export function combineKey(state: KeyState, key: string, kh: KeyHistory, history: ItemHistory): CombinedValue | null {
  switch (kh.kind) {
    case "set":
      return combineSet(state, key, kh, history)
    case "reg":
      return combineRegister(state)
    default:
      return assertNever(kh.kind)
  }
}

function combineRegister(state: KeyState): CombinedValue | null {
  // Spec #454: one lone value renders its canonical source verbatim; several values (or values
  // beside set content) render as ONE double-quoted string of their canonical sources, deduped
  // and sorted by UTF-8 bytes, joined with " / ", so '3' and 3 stay distinct components.
  const values = registerValues(state.reg)
  const sole = values.length === 1 && state.set.length === 0
  const parts = [...new Set([...values, ...state.set.map((e) => e.element)])].sort(utf8Compare)
  if (parts.length === 0) return null
  return { kind: "reg", text: parts.join(" / "), verbatim: sole }
}

function utf8Compare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"))
}

function combineSet(state: KeyState, key: string, kh: KeyHistory, history: ItemHistory): CombinedValue | null {
  const tagged: { readonly stamp: Stamp; readonly source: string }[] = state.set.map(({ tag, element }) => ({
    source: element,
    stamp: addStamp(history, key, "set", tag, kh.byKind.get("set")),
  }))
  // A register inside a set contributes its canonical source as one element, keeping its YAML
  // type (review r6 M1: 3 stays a number, not the string "3").
  for (const entry of activeReg(state.reg)) {
    const stamp = addStamp(history, key, "reg", entry.tag, kh.byKind.get("reg"))
    // A whole list held by the register contributes its elements, not a nested list.
    for (const source of sequenceElements(entry.value) ?? [entry.value]) tagged.push({ source, stamp })
  }
  tagged.sort((a, b) => stampCompare(a.stamp, b.stamp) || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))
  const elements = [...new Set(tagged.map((t) => t.source))]
  return elements.length === 0 ? null : { kind: "set", elements }
}

function assertNever(value: never): never {
  throw new Error(`unhandled field kind: ${String(value)}`)
}
