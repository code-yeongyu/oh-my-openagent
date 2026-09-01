// Recall candidate selection: scores recall documents against the planned
// queries with the FTS-lite AND-semantics scorer and keeps the best hit per
// path. matchScore is reused over a description+body haystack (the SearchDocument
// projection does not fit recall files, so the haystack is composed directly).

import { matchScore, normalizeText, parseQuery } from "../search"
import type { RecallDocument } from "./provider"

export interface RecallCandidate {
  readonly path: string
  readonly description: string
  readonly excerpt: string
  readonly score: number
}

/** Excerpt window length. Internal, deliberately not a config knob. */
const EXCERPT_CHARS = 200

export interface SelectRecallOptions {
  readonly maxItems: number
  /** Paths already surfaced earlier in the session; they never repeat. */
  readonly surfaced: ReadonlySet<string>
}

export function selectRecallCandidates(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  options: SelectRecallOptions,
): RecallCandidate[] {
  const maxItems = Math.max(0, options.maxItems)
  const parsedQueries = queries.map(parseQuery).filter((query) => query.terms.length > 0 || query.phrases.length > 0)
  if (maxItems === 0 || parsedQueries.length === 0) return []

  const queryTerms = collectQueryTerms(parsedQueries)
  const scored: RecallCandidate[] = []
  for (const document of documents) {
    if (options.surfaced.has(document.path)) continue

    const haystack = `${document.description}\n${document.body}`
    let best: number | null = null
    for (const parsed of parsedQueries) {
      const score = matchScore(haystack, parsed)
      if (score === null) continue
      if (best === null || score < best) best = score
    }
    if (best === null) continue

    scored.push({
      path: document.path,
      description: document.description,
      excerpt: buildExcerpt(document.body, queryTerms),
      score: best,
    })
  }

  return scored
    .sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
    .slice(0, maxItems)
}

function collectQueryTerms(
  parsedQueries: readonly { terms: readonly string[]; phrases: readonly string[] }[],
): string[] {
  const terms: string[] = []
  for (const parsed of parsedQueries) {
    terms.push(...parsed.terms)
    for (const phrase of parsed.phrases) terms.push(...phrase.split(/\s+/).filter(Boolean))
  }
  return terms
}

/**
 * Excerpt is a body region centered on the first query-term match, or the body
 * head when no query term matches the body. Whitespace is collapsed to single
 * spaces and the result never exceeds EXCERPT_CHARS.
 */
function buildExcerpt(body: string, terms: readonly string[]): string {
  const normalized = body.replace(/\s+/g, " ").trim()
  if (normalized === "") return ""

  const lowered = normalized.toLowerCase()
  let matchIndex = -1
  let matchLength = 0
  for (const term of terms) {
    const needle = normalizeText(term)
    if (needle === "") continue
    const index = lowered.indexOf(needle)
    if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
      matchIndex = index
      matchLength = needle.length
    }
  }
  if (matchIndex < 0) return normalized.slice(0, EXCERPT_CHARS)

  const start = Math.max(0, matchIndex - Math.floor((EXCERPT_CHARS - matchLength) / 2))
  const end = Math.min(normalized.length, start + EXCERPT_CHARS)
  const clampedStart = Math.max(0, end - EXCERPT_CHARS)
  return normalized.slice(clampedStart, end).trim()
}
