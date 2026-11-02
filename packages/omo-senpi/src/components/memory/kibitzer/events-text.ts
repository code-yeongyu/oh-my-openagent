// Bounded text for the event stream: redaction (memory-core masks, then senpi's), head truncation
// that never splits a surrogate pair, XML escaping for the rendered fragment, and the one-line
// digest that stands for every event folded out of the buffer while always naming its cursor range.

import { redactUrl } from "@oh-my-opencode/memory-core"

import { redactSensitiveOutput } from "./sensitive-output"

export const KIBITZER_DIGEST_MAX_CHARS = 1024
export const DIGEST_TAIL_FRAGMENTS = 12
const DIGEST_FRAGMENT_CHARS = 72

export interface FoldState {
  count: number
  firstSeq: number
  lastSeq: number
  firstCursor: number
  lastCursor: number
  /** Fragment of the first folded event: the task's origin usually lives there. */
  readonly head: string
  /** Newest folded fragments after the head, oldest first, bounded. */
  readonly tail: string[]
}

/** memory-core credential/secret masks first, then the senpi `core/sensitive-output` patterns. */
export function redactKibitzerEventText(text: string): string {
  return redactSensitiveOutput(redactUrl(text))
}

/**
 * Head truncation to exactly `cap` characters with a trailing marker for the characters beyond the
 * cap; the marker itself displaces a few more. A cap too small for the marker is a plain cut.
 */
export function truncateHead(text: string, cap: number): string {
  const marker = ` [+${text.length - cap} chars]`
  if (cap <= marker.length) return withoutDanglingSurrogate(text.slice(0, cap))
  return `${withoutDanglingSurrogate(text.slice(0, cap - marker.length))}${marker}`
}

function withoutDanglingSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

/** One folded event as it appears in the digest: kind (and tool), error flag, clipped body. */
export function fragmentOf(event: { readonly kind: string; readonly tool?: string; readonly isError?: boolean; readonly body: string }): string {
  const label = event.tool === undefined ? event.kind : `${event.kind}(${event.tool})`
  const status = event.isError === true ? " error" : ""
  const body = event.body.replace(/\s+/g, " ").trim()
  const clipped = body.length > DIGEST_FRAGMENT_CHARS ? `${body.slice(0, DIGEST_FRAGMENT_CHARS)}...` : body
  return `${label}${status} "${clipped}"`
}

/**
 * Header (count, seq range, cursor range) plus the head fragment, an elision marker, and as many of
 * the newest tail fragments as fit. Redacted again after composition, then hard-capped from the tail
 * so the header - and with it both cursors - always survives.
 */
export function digestLine(fold: FoldState): string {
  const header = `${fold.count} earlier events folded (seq ${fold.firstSeq}-${fold.lastSeq}, cursor ${fold.firstCursor}..${fold.lastCursor}): `
  const budget = Math.max(0, KIBITZER_DIGEST_MAX_CHARS - header.length)
  let tail = [...fold.tail]
  let elided = fold.count - 1 - tail.length
  let body = joinFragments(fold.head, elided, tail)
  while (body.length > budget && tail.length > 0) {
    tail = tail.slice(1)
    elided += 1
    body = joinFragments(fold.head, elided, tail)
  }
  const line = redactKibitzerEventText(`${header}${body}`).replace(/[\r\n]+/g, " ")
  return line.length <= KIBITZER_DIGEST_MAX_CHARS ? line : line.slice(0, KIBITZER_DIGEST_MAX_CHARS)
}

function joinFragments(head: string, elided: number, tail: readonly string[]): string {
  return [head, ...(elided > 0 ? [`... ${elided} more ...`] : []), ...tail].join(" | ")
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => XML_ESCAPES[character] ?? character)
}

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }
