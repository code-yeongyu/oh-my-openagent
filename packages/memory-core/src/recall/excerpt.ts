// Recall excerpts: the body window a candidate shows. Building one collapses the whole body's
// whitespace, so selection builds them only for the candidates it returns.

import { normalizeText } from "../search"

/** Excerpt window length. Internal, deliberately not a config knob. */
const EXCERPT_CHARS = 200

/**
 * Excerpt is a body region centered on the first query-term match, or the body
 * head when no query term matches the body. Each list of fallback terms is searched
 * only when no earlier list matches. Whitespace is collapsed to single spaces and the
 * result never exceeds EXCERPT_CHARS.
 */
export function buildExcerpt(body: string, terms: readonly string[], ...fallbackTerms: readonly (readonly string[])[]): string {
  const normalized = body.replace(/\s+/g, " ").trim()
  if (normalized === "") return ""

  const lowered = normalized.toLowerCase()
  let matchIndex = -1
  let matchLength = 0
  for (const candidates of [terms, ...fallbackTerms]) {
    if (matchIndex >= 0) break
    for (const term of candidates) {
      const needle = normalizeText(term)
      if (needle === "") continue
      const index = lowered.indexOf(needle)
      if (index >= 0 && (matchIndex < 0 || index < matchIndex)) {
        matchIndex = index
        matchLength = needle.length
      }
    }
  }
  if (matchIndex < 0) return normalized.slice(0, EXCERPT_CHARS)

  const start = Math.max(0, matchIndex - Math.floor((EXCERPT_CHARS - matchLength) / 2))
  const end = Math.min(normalized.length, start + EXCERPT_CHARS)
  const clampedStart = Math.max(0, end - EXCERPT_CHARS)
  return normalized.slice(clampedStart, end).trim()
}
