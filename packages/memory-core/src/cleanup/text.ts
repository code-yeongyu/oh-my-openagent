// Text primitives for the cleanup planner: paragraph normalisation, set similarity and the dated-series file grammar.
// Every rule here is deterministic and inspectable; the planner quotes the numbers these functions produce as evidence.

import { createHash } from "node:crypto"
import { posix } from "node:path"

export interface Paragraph {
  /** The paragraph as written, so a merge can carry it over verbatim. */
  readonly text: string
  /** Normalised key: two paragraphs that differ only in markup, case or whitespace share one key. */
  readonly key: string
}

/** Paragraphs shorter than this after normalisation (a bare heading, a one-word line) carry no fact worth matching. */
const MIN_PARAGRAPH_CHARS = 12

/** Split a markdown body on blank lines into paragraphs that carry a normalised key. */
export function splitParagraphs(body: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  for (const chunk of body.replace(/\r\n/g, "\n").split(/\n[ \t]*\n+/)) {
    const text = chunk.replace(/^\n+|\n+$/g, "")
    const key = normalizeText(text)
    if (key.length < MIN_PARAGRAPH_CHARS) continue
    paragraphs.push({ text, key: digest(key) })
  }
  return paragraphs
}

/** Lower-case, markup-free, whitespace-collapsed form of a span of markdown. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, ""))
    .join(" ")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** One key for a whole body: equal keys mean the two notes say the same thing in the same words. */
export function bodyKey(body: string): string {
  return digest(normalizeText(body))
}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24)
}

/** |a ∩ b| / |a ∪ b| over paragraph keys; 0 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const shared = sharedCount(a, b)
  const union = a.size + b.size - shared
  return union === 0 ? 0 : shared / union
}

/** The share of `inner`'s paragraphs that `outer` also carries; 0 when `inner` is empty. */
export function containment(inner: ReadonlySet<string>, outer: ReadonlySet<string>): number {
  return inner.size === 0 ? 0 : sharedCount(inner, outer) / inner.size
}

export function sharedCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const key of small) if (large.has(key)) shared += 1
  return shared
}

/** A file name whose stem ends in a date: `<stem>-YYYYMMDD[a-z][-HHMM][-TOKEN].md`. */
export interface DatedName {
  /** Directory plus stem, shared by every version of the series. */
  readonly series: string
  /** Sortable version: date, optional letter, optional clock. */
  readonly version: string
  /** A retirement token the name itself carries. */
  readonly retired?: RetirementToken
}

export const RETIREMENT_TOKENS = ["LIFTED", "EXPIRED", "RETIRED", "SUPERSEDED"] as const
export type RetirementToken = (typeof RETIREMENT_TOKENS)[number]

const DATED_NAME_RE = /^(.*?)-(\d{8})([a-z]?)(?:-(\d{4}))?(?:-(LIFTED|EXPIRED|RETIRED|SUPERSEDED))?\.md$/

export function parseDatedName(path: string): DatedName | undefined {
  const match = DATED_NAME_RE.exec(posix.basename(path))
  const stem = match?.[1]
  const date = match?.[2]
  if (match === null || stem === undefined || stem === "" || date === undefined) return undefined
  const day = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00Z`)
  if (Number.isNaN(day)) return undefined
  const token = match[5]
  return {
    series: posix.join(posix.dirname(path), stem),
    version: `${date}${match[3] ?? ""}-${match[4] ?? "0000"}`,
    ...(isRetirementToken(token) ? { retired: token } : {}),
  }
}

/** A retirement token anywhere in the file name (`foo-LIFTED.md`, `foo-20261105-EXPIRED.md`). */
export function retirementTokenOf(path: string): RetirementToken | undefined {
  const name = posix.basename(path)
  for (const token of RETIREMENT_TOKENS) {
    if (new RegExp(`(?:^|[-_.])${token}(?:[-_.]|\\.md$)`).test(name)) return token
  }
  return undefined
}

function isRetirementToken(value: string | undefined): value is RetirementToken {
  return value !== undefined && (RETIREMENT_TOKENS as readonly string[]).includes(value)
}
