// Frontmatter split and typing (sync-design §2). The split grammar is the one the
// repository already uses (leading "---" line, closing "---" line). A block that is not
// valid YAML, is empty, or is not a mapping has no frontmatter part: the whole file is
// the body, so text is never lost to a parse failure. A key's CRDT kind is declared by the
// YAML node type of its value, never by its length or content (review r5, lead decision):
// every scalar (string, number, boolean, date) -> multi-value register holding its canonical
// YAML source, mapping -> register holding its YAML flow source, sequence -> set,
// null -> removal. Only the body is text: concurrent edits to one frontmatter value keep both
// whole values (a register conflict) instead of being merged character by character.

import { Document, Scalar, YAMLSeq, isMap, isScalar, isSeq, parseDocument, stringify } from "yaml"
import type { Node } from "yaml"

export type FmValue =
  | { readonly kind: "set"; readonly elements: readonly string[]; readonly flow: string }
  | { readonly kind: "reg"; readonly value: string }
  | { readonly kind: "remove" }

export interface FmEntry {
  readonly key: string
  readonly value: FmValue
}

export interface ParsedItemText {
  readonly fm: readonly FmEntry[] | null
  readonly body: string
}

export function splitItem(raw: string): ParsedItemText {
  const text = withoutBom(raw)
  const parts = splitHeader(text)
  if (parts === null) return { fm: null, body: text }
  const fm = parseHeader(parts.header)
  if (fm === null) return { fm: null, body: text }
  return { fm, body: parts.body }
}

/**
 * Canonical scalar source for storage and render: a self-contained YAML scalar that is never a
 * block scalar and never folded (lineWidth 0), so the same source parses on its own, as a
 * component of a multi-value register, and as a set element. A string that would render as a
 * block is double-quoted with escapes instead (t05 report). A double-quoted source can still span
 * lines where the emitter breaks at an escaped newline; render parses sources into nodes, so this
 * is lossless (delta review 0bde9bc01e).
 */
export function renderScalar(value: string | number | boolean): string {
  // Only the emitter's final newline is stripped: NBSP, BOM, U+3000 and similar are value content.
  const plain = stringify(value, { lineWidth: 0 }).replace(/\n$/, "")
  if (typeof value !== "string" || (!plain.includes("\n") && parsesTo(plain, value))) return plain
  return stringify(doubleQuoted(value), { lineWidth: 0 }).replace(/\n$/, "")
}

/**
 * One frontmatter value as a YAML node (spec #454, lead decision r6): a lone register's
 * canonical source is parsed into its node; several register values are one double-quoted
 * string; a set's element sources become a sequence of their nodes. Nothing is concatenated
 * as text, and a source that does not parse is a broken invariant: it throws, it is never
 * written as if it were the value.
 */
export function valueNode(value: string | readonly string[], verbatim: boolean): Node {
  if (typeof value !== "string") return sequenceOf(value)
  return verbatim ? sourceNode(value) : doubleQuoted(value)
}

/** The frontmatter block (without the --- fences) for `entries`, emitted as ONE YAML document. */
export function emitFrontmatter(entries: readonly { readonly key: string; readonly node: Node }[]): string {
  const doc = new Document({}, { schema: "core" })
  for (const { key, node } of entries) doc.set(key, node)
  return stringify(doc, { lineWidth: 0 }).trimEnd()
}

export function renderEntry(key: string, value: string | readonly string[], verbatim = false): string {
  return emitFrontmatter([{ key, node: valueNode(value, verbatim) }])
}

/** `text` without a leading UTF-8 BOM: the BOM is an encoding marker, not content (t05 r7). */
export function withoutBom(text: string): string {
  return text.startsWith("\ufeff") ? text.slice(1) : text
}

/** The raw frontmatter source and the body of `text`, or null when `text` has no frontmatter fences. */
export function splitHeader(text: string): { readonly header: string; readonly body: string } | null {
  const open = text.startsWith("---\r\n") ? 5 : text.startsWith("---\n") ? 4 : 0
  if (open === 0) return null
  const end = text.indexOf("\n---", open)
  if (end < 0) return null
  const nl = text.indexOf("\n", end + 4)
  const closeEnd = nl < 0 ? text.length : nl
  if (text.slice(end + 4, closeEnd).trim() !== "") return null
  // A CRLF file's fences and last header line end in "\r\n": the CR belongs to the line ending.
  const header = text.slice(open, text[end - 1] === "\r" ? Math.max(open, end - 1) : end)
  if (header.trim() === "") return null
  return { header, body: nl < 0 ? "" : text.slice(nl + 1) }
}

/** The element sources of a canonical source that is a sequence, or null for any other value. */
export function sequenceElements(source: string): string[] | null {
  const parsed = parseDocument(source, { schema: "core" })
  if (parsed.errors.length > 0 || !isSeq(parsed.contents)) return null
  const items: unknown = parsed.toJS()
  return Array.isArray(items) ? items.map(elementSource) : null
}

// The plain form must survive the exact path render takes (source -> node -> emitted entry ->
// parse); the emitter drops some trailing Unicode spaces from plain scalars.
function parsesTo(source: string, value: string): boolean {
  const parsed = parseDocument(source, { schema: "core" })
  if (parsed.errors.length > 0 || parsed.toJS() !== value || parsed.contents === null) return false
  const entry = parseDocument(emitFrontmatter([{ key: "k", node: parsed.contents }]), { schema: "core" }).toJS()
  return isRecord(entry) && entry.k === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sourceNode(source: string): Node {
  const parsed = parseDocument(source, { schema: "core" })
  const node = parsed.contents
  if (parsed.errors.length > 0 || node === null) throw new Error(`invalid canonical source: ${JSON.stringify(source)}`)
  return node
}

function doubleQuoted(value: string): Scalar {
  const scalar = new Scalar(value)
  scalar.type = "QUOTE_DOUBLE"
  return scalar
}

function sequenceOf(sources: readonly string[]): YAMLSeq {
  const seq = new YAMLSeq()
  for (const source of sources) seq.items.push(sourceNode(source))
  return seq
}

// Aliases and merge keys resolve BEFORE classification (spec #454): a value is classified by
// what it resolves to. A custom tag (one the core schema cannot resolve) or an alias bomb makes
// the frontmatter invalid, so the whole file stays body and nothing is lost.
function parseHeader(header: string): readonly FmEntry[] | null {
  const doc = parseDocument(header, { schema: "core", merge: true })
  if (doc.errors.length > 0 || doc.warnings.some((w) => w.code === "TAG_RESOLVE_FAILED")) return null
  const contents = doc.contents
  if (contents === null || !isMap(contents)) return null
  for (const pair of contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") return null
  }
  let resolved: unknown
  try {
    resolved = doc.toJS({ maxAliasCount: 64 })
  } catch (error) {
    if (error instanceof ReferenceError || error instanceof TypeError) return null
    throw error
  }
  if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) return null
  return Object.entries(resolved).map(([key, value]) => ({ key, value: classify(value) }))
}

function classify(value: unknown): FmValue {
  if (value === null || value === undefined) return { kind: "remove" }
  if (Array.isArray(value)) return { kind: "set", elements: value.map(elementSource), flow: flowOf(value) }
  if (typeof value === "object") return { kind: "reg", value: flowOf(value) }
  return { kind: "reg", value: scalarSource(value) }
}

function elementSource(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "object") return flowOf(value)
  return scalarSource(value)
}

function scalarSource(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return renderScalar(value)
  return renderScalar(String(value))
}

function flowOf(node: unknown): string {
  return stringify(node, { collectionStyle: "flow", lineWidth: 0 }).trim()
}
