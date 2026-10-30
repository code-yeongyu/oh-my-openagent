// What the engine writes to disk (lead decision r6, design (b)). The merged typed model decides
// the content; the file on disk decides the style:
// - a file whose typed model already equals the doc's is returned byte-for-byte, whatever its
//   quoting, spacing or comments;
// - otherwise the disk frontmatter is spliced at the parser's exact pair offsets: a changed key's
//   span is replaced by its emitted node, a removed key's span is cut, new keys follow the last
//   key, and every untouched byte (values, quoting, folding, spacing, comments) is kept as is;
// - when only the body changed, the disk's frontmatter bytes are kept exactly;
// - an alias whose anchor is in a changed or deleted key is inlined: the key using it is re-emitted
//   from the model, which holds resolved values (spec #454);
// - when the disk frontmatter does not parse, has a top-level merge key, or the patched result
//   would not parse back to exactly the doc's model, the canonical render is written instead;
// - the patch is a style-preserving optimization only: any exception inside it falls back to the
//   canonical render, which is always a correct write.
// A comment attached to a changed or removed key is not kept (the model has no comments).

import type { LoroDoc } from "../../crdt/loro-runtime"
import { isAlias, isCollection, isMap, isNode, isPair, isScalar, parseDocument } from "yaml"

import type { FmValue } from "./frontmatter"
import { emitFrontmatter, splitHeader, splitItem, withoutBom } from "./frontmatter"
import type { FrontmatterEntry } from "./render"
import { bodyOf, frontmatterEntries, renderItem } from "./render"

interface Model {
  readonly fields: ReadonlyMap<string, string>
  readonly body: string
}

type Patcher = (doc: LoroDoc, diskText: string, want: Model) => string | null

export function renderForDisk(doc: LoroDoc, diskText: string, patch: Patcher = patchDisk): string | null {
  const canonical = renderItem(doc)
  if (canonical === null) return null
  const want = modelOf(canonical)
  if (sameModel(want, modelOf(diskText))) return diskText
  // A leading BOM is the file's own encoding marker: written back exactly when the disk had one,
  // and never from the doc, whose text never starts with one.
  const disk = withoutBom(diskText)
  const bom = diskText.slice(0, diskText.length - disk.length)
  const eol = eolOf(disk)
  const patched = tryPatch(patch, doc, disk, want)
  if (patched !== null && sameModel(modelOf(patched), want)) return `${bom}${patched}`
  const bare = withoutBom(canonical)
  const styled = withEol(bare, eol)
  return `${bom}${sameModel(modelOf(styled), want) ? styled : bare}`
}

// The file's dominant line ending (lead r6): the majority of its line breaks, ties to the first
// break. Every line the client writes (re-emitted, added, and fences it creates) uses it; lines it
// does not touch keep their own bytes, so a mixed file stays mixed only where it already was.
function eolOf(text: string): string {
  const crlf = text.split("\r\n").length - 1
  const lf = text.split("\n").length - 1 - crlf
  if (crlf !== lf) return crlf > lf ? "\r\n" : "\n"
  const nl = text.indexOf("\n")
  return nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n"
}

function withEol(canonical: string, eol: string): string {
  const parts = eol === "\n" ? null : splitHeader(canonical)
  if (parts === null) return canonical
  return `---${eol}${parts.header.replaceAll("\n", eol)}${eol}---${eol}${parts.body}`
}

function tryPatch(patch: Patcher, doc: LoroDoc, diskText: string, want: Model): string | null {
  try {
    return patch(doc, diskText, want)
  } catch {
    // Fail safe by design (delta review 0bde9bc01e): the caller writes the canonical render.
    return null
  }
}

function patchDisk(doc: LoroDoc, diskText: string, want: Model): string | null {
  const parts = splitHeader(diskText)
  const entries = frontmatterEntries(doc)
  if (parts === null || entries.length === 0) return null
  const disk = parseDocument(parts.header, { schema: "core", merge: true })
  if (disk.errors.length > 0 || !isMap(disk.contents)) return null
  const have = modelOf(diskText).fields
  if (sameFields(have, want.fields)) return `${diskText.slice(0, diskText.length - parts.body.length)}${bodyOf(doc)}`
  const changed = reEmitKeys(disk.contents.items, changedKeys(have, want.fields))
  if (changed === null) return null
  const eol = eolOf(diskText)
  const region = rawRegion(diskText, parts.body.length)
  if (region === null) return null
  const spans = pairSpans(region.items, region.source)
  if (spans === null) return null
  return `${region.open}${spliceHeader(region.source, spans, entries, changed, want.fields, eol)}${region.close}${bodyOf(doc)}`
}

interface RawRegion {
  readonly open: string
  readonly source: string
  readonly close: string
  readonly items: readonly unknown[]
}

// The disk's own bytes around the frontmatter: its opening fence line, the header lines including
// the last line's own break, and its closing fence line. Untouched, they are copied as they are.
function rawRegion(text: string, bodyLength: number): RawRegion | null {
  const openLength = text.startsWith("---\r\n") ? 5 : 4
  const end = text.indexOf("\n---", openLength)
  const bodyStart = text.length - bodyLength
  if (end < 0 || end + 1 > bodyStart) return null
  const source = text.slice(openLength, end + 1)
  const parsed = parseDocument(source, { schema: "core", merge: true })
  if (parsed.errors.length > 0 || !isMap(parsed.contents)) return null
  return { open: text.slice(0, openLength), source, close: text.slice(end + 1, bodyStart), items: parsed.contents.items }
}

interface PairSpan {
  readonly key: string
  readonly start: number
  readonly end: number
}

// Top-level pairs by their exact source offsets from the parser: [key start, node end), which
// covers the value, its inline comment and its line break.
function pairSpans(pairs: readonly unknown[], source: string): PairSpan[] | null {
  const spans: PairSpan[] = []
  for (const pair of pairs) {
    if (!isPair(pair) || !isScalar(pair.key) || !isNode(pair.value)) return null
    const start = pair.key.range?.[0]
    const end = pair.value.range?.[2]
    if (start === undefined || end === undefined) return null
    // The last pair's node end can stop before its line break; a span always owns its line break.
    spans.push({ key: String(pair.key.value), start, end: end + lineBreakAt(source, end) })
  }
  return spans
}

// Untouched bytes are copied as they are; only changed keys are re-emitted (lead decision r6).
// A changed key keeps the comment lines above it and loses its old inline comment; a deleted key
// takes the comment lines directly above it; new keys follow the last key.
function spliceHeader(
  source: string,
  spans: readonly PairSpan[],
  entries: readonly FrontmatterEntry[],
  changed: ReadonlySet<string>,
  want: ReadonlyMap<string, string>,
  eol: string,
): string {
  const onDisk = new Set(spans.map((span) => span.key))
  const nodes = new Map(entries.map((entry) => [entry.key, entry.node]))
  const added = entries.filter((entry) => !onDisk.has(entry.key)).map((entry) => emitLine(entry.key, entry.node, eol))
  let out = ""
  let cursor = 0
  for (const span of spans) {
    const node = nodes.get(span.key)
    if (!changed.has(span.key)) continue
    if (!want.has(span.key) || node === undefined) {
      const from = commentBlockStart(source, span.start)
      out += source.slice(cursor, from)
    } else {
      out += source.slice(cursor, span.start) + emitLine(span.key, node, eol)
    }
    cursor = span.end
  }
  const tailFrom = spans.length === 0 ? 0 : (spans[spans.length - 1]?.end ?? 0)
  if (cursor <= tailFrom) {
    out += source.slice(cursor, tailFrom)
    cursor = tailFrom
  }
  return out + added.join("") + source.slice(cursor)
}

function emitLine(key: string, node: FrontmatterEntry["node"], eol: string): string {
  return `${emitFrontmatter([{ key, node }]).replaceAll("\n", eol)}${eol}`
}

function lineBreakAt(source: string, end: number): number {
  if (source[end - 1] === "\n") return 0
  if (source.startsWith("\r\n", end)) return 2
  return source[end] === "\n" ? 1 : 0
}

function commentBlockStart(source: string, start: number): number {
  let from = start
  while (from > 0) {
    const lineStart = source.lastIndexOf("\n", from - 2) + 1
    if (!source.slice(lineStart, from).startsWith("#")) break
    from = lineStart
  }
  return from
}

function changedKeys(have: ReadonlyMap<string, string>, want: ReadonlyMap<string, string>): Set<string> {
  const changed = new Set<string>()
  for (const key of new Set([...have.keys(), ...want.keys()])) if (have.get(key) !== want.get(key)) changed.add(key)
  return changed
}

// Keys to re-emit from the model: the changed ones, plus every key that uses an alias to an anchor
// defined in a re-emitted or deleted key (repeated until stable). The model holds resolved values
// (spec #454), so re-emitting a user inlines the alias and no alias is left without its anchor.
// A top-level merge key or a non-scalar key is not patchable: null, and the caller re-renders.
function reEmitKeys(pairs: readonly unknown[], changed: ReadonlySet<string>): Set<string> | null {
  const defines = new Map<string, Set<string>>()
  const uses = new Map<string, Set<string>>()
  for (const pair of pairs) {
    if (!isPair(pair) || !isScalar(pair.key)) return null
    const key = String(pair.key.value)
    if (key === "<<") return null
    defines.set(key, new Set([...anchorsIn(pair.key), ...anchorsIn(pair.value)]))
    uses.set(key, aliasesIn(pair.value))
  }
  const out = new Set(changed)
  let grew = true
  while (grew) {
    grew = false
    const lost = new Set([...out].flatMap((key) => [...(defines.get(key) ?? [])]))
    for (const [key, names] of uses) {
      if (out.has(key) || ![...names].some((name) => lost.has(name))) continue
      out.add(key)
      grew = true
    }
  }
  return out
}

function anchorsIn(node: unknown): string[] {
  const own = isNode(node) && !isAlias(node) && node.anchor !== undefined ? [node.anchor] : []
  return [...own, ...childrenOf(node).flatMap(anchorsIn)]
}

function aliasesIn(node: unknown): Set<string> {
  if (isAlias(node)) return new Set([node.source])
  return new Set(childrenOf(node).flatMap((child) => [...aliasesIn(child)]))
}

function childrenOf(node: unknown): unknown[] {
  if (!isCollection(node)) return []
  return node.items.flatMap((item) => (isPair(item) ? [item.key, item.value] : [item]))
}

function modelOf(text: string): Model {
  const parsed = splitItem(text)
  const fields = new Map<string, string>()
  for (const { key, value } of parsed.fm ?? []) fields.set(key, fieldKey(value))
  return { fields, body: parsed.body }
}

// A set is compared as a set: element order on disk is style.
function fieldKey(value: FmValue): string {
  return value.kind === "set" ? JSON.stringify(["set", [...value.elements].sort()]) : JSON.stringify(value)
}

function sameModel(a: Model, b: Model): boolean {
  return a.body === b.body && sameFields(a.fields, b.fields)
}

function sameFields(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) if (b.get(key) !== value) return false
  return true
}
