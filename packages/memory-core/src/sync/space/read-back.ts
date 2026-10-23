// The read-back gate every adoption deletion goes through. It is structure-free: it never
// parses the source into blocks. Every raw source line (line endings normalised, nothing else)
// must appear in the merged result at least as many times as in the source. The only lines the
// adopt step may drop are the enumerated metadata lines (droppableAllowance) and key lines the
// result represents, each metadata kind bounded by a count taken from the source itself. A missing line that is none of those keeps the source.
// A key line is represented only by an active register entry or a set element of the result
// (sync-design #454 §3): a register line is accounted for when its value is one of the key's
// active entries, never because a joined " / " render happens to contain it, nor because a joined
// line of the result's header is textually equal to the source line (review r10: `k: "a / b"` over
// the values a and b is not the value "a / b"). A body line of the result is text, whatever key it
// looks like (#10321). The read rule is ACTIVE entries only, on purpose: a superseded value
// is no longer held, so a side file carrying only that value is kept. The write guard
// (item/key-writers.ts addRegisterValue) is the other rule, ANY entry: a superseded value was
// written once and is never written again. Kept-but-never-rewritten is the intended pair. So a
// device that deliberately sets a key back to a value the space held earlier, through a side file,
// does not get it adopted, and the side stays on disk: a snapshot cannot tell a revert from a stale
// replay. Editing the main file writes the old value through an ordinary capture (#10321).

import { splitHeader, splitItem, type FmValue } from "../item/frontmatter"

const T2_HEADER =
  /^<!-- memory-sync \d{4}-\d{2}-\d{2}: the other machine had different frontmatter for .+; kept here so no fact is lost:$/

export function toLf(text: string): string {
  return text.replace(/\r\n/g, "\n")
}

/** How every adopted file is read: a leading UTF-8 BOM is not text (review r7 M2), CRLF becomes LF. */
export function normalizeInput(text: string): string {
  return toLf(text.startsWith("\uFEFF") ? text.slice(1) : text)
}

export function linesOf(text: string): readonly string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()
  return lines
}

function countLines(lines: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  return counts
}

type ResultFact = { readonly kind: "reg"; readonly values: readonly string[] } | { readonly kind: "set"; readonly elements: readonly string[] }

function valueSurvives(wanted: FmValue, actual: ResultFact): boolean {
  const held = actual.kind === "reg" ? actual.values : actual.elements
  switch (wanted.kind) {
    case "set":
      return actual.kind === "set" ? wanted.elements.every((element) => held.includes(element)) : held.includes(wanted.flow)
    case "reg":
      return held.includes(wanted.value)
    case "remove":
      return false
  }
}

/** The result's keys: a register's components from `registers` when it has them, else its rendered value as one whole value. */
function resultFacts(rendered: string, registers: ReadonlyMap<string, readonly string[]>): Map<string, ResultFact> {
  const facts = new Map<string, ResultFact>()
  for (const { key, value } of splitItem(rendered).fm ?? []) {
    if (value.kind === "set") facts.set(key, { kind: "set", elements: value.elements })
    else if (value.kind === "reg") facts.set(key, { kind: "reg", values: registers.get(key) ?? [value.value] })
  }
  return facts
}

/**
 * A single source line that, read alone as a one-key frontmatter header (T2 blocks escape
 * "-->" as "-- >"), names a key whose value the result represents. Line-local: no block
 * structure is consulted, and a multi-line value never qualifies (the source is kept).
 */
function isRepresentedKeyLine(line: string, facts: ReadonlyMap<string, ResultFact>): boolean {
  for (const candidate of new Set([line, line.replace(/-- >/g, "-->")])) {
    const entries = splitItem(`---\n${candidate}\n---\n`).fm
    if (entries === null || entries.length !== 1) continue
    const [entry] = entries
    const fact = entry === undefined ? undefined : facts.get(entry.key)
    if (entry !== undefined && fact !== undefined && valueSurvives(entry.value, fact)) return true
  }
  return false
}

/** A header line of the result that renders a register of two or more components: it holds no single written value. */
function isJoinedRegisterLine(line: string, registers: ReadonlyMap<string, readonly string[]>): boolean {
  const entries = splitItem(`---\n${line}\n---\n`).fm
  const [entry] = entries ?? []
  return entries?.length === 1 && entry !== undefined && (registers.get(entry.key)?.length ?? 0) > 1
}

/**
 * The enumerated metadata lines adoption may drop, each with how many of them a source may
 * lose: a T2 header carries no fact (all of them); per T2 header, one closing "-->" (or the
 * hub's fused "----->", its kept header's closing fence plus "-->"), one blank
 * separator and the block's two "---" fences; plus the two fences of the file's own header, only
 * when the source has one (review r7 L1: without a header, "---" lines are horizontal rules).
 */
function droppableAllowance(source: readonly string[], hasHeader: boolean): Map<string, number> {
  const headers = source.filter((line) => T2_HEADER.test(line)).length
  return new Map([
    ["-->", headers],
    ["----->", headers],
    ["", headers],
    ["---", (hasHeader ? 2 : 0) + 2 * headers],
  ])
}

/**
 * The result's lines that count as held text. A joined register line counts for nothing, but only
 * inside the result's own header: a body line is text, whatever key it looks like (#10321).
 */
function heldLines(rendered: string, registers: ReadonlyMap<string, readonly string[]>): string[] {
  const lines = linesOf(rendered)
  const parts = splitItem(rendered).fm === null ? null : splitHeader(rendered.replace(/^\uFEFF/, ""))
  if (parts === null) return [...lines]
  const headerEnd = 1 + linesOf(`${parts.header}\n`).length
  return lines.filter((line, index) => index < 1 || index >= headerEnd || !isJoinedRegisterLine(line, registers))
}

/**
 * Name the first source line (LF text) the merged result does not hold as many times as the
 * source does, after the enumerated metadata allowance and represented key lines. Null means
 * the source is safe to delete. `registers` is required (#10321): it is the space's active
 * components per register key; a caller with no doc passes an empty map, which reads every
 * rendered register as one whole value.
 */
export function firstMissingFact(rendered: string, source: string, registers: ReadonlyMap<string, readonly string[]>): string | null {
  const sourceLines = linesOf(source)
  const have = countLines(heldLines(rendered, registers))
  const allowance = droppableAllowance(sourceLines, splitItem(source).fm !== null)
  const facts = resultFacts(rendered, registers)
  for (const [line, count] of countLines(sourceLines)) {
    const missing = count - (have.get(line) ?? 0)
    if (missing <= 0 || T2_HEADER.test(line)) continue
    const allowed = allowance.get(line)
    if (allowed !== undefined) {
      if (missing <= allowed) continue
      return `missing line ${JSON.stringify(line)} (${missing} dropped, ${allowed} allowed as metadata)`
    }
    if (isRepresentedKeyLine(line, facts)) continue
    return missing === count
      ? `missing line ${JSON.stringify(line)}`
      : `missing line ${JSON.stringify(line)} (${count} in the source, ${count - missing} merged)`
  }
  return null
}
