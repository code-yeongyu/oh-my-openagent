// Normalized recall haystacks, shared by the substring scorer and the strategy selector so a corpus
// revision reads each document body once.

import { normalizeText } from "../search"
import type { RecallDocument } from "./provider"

/**
 * Normalized `description\nbody` per document object. RecallCorpusCache hands out the same document
 * object for as long as its blob has not changed, even across HEAD moves, so the memo lives exactly as
 * long as the content it was derived from; a changed file gets a fresh object and drops it. Composing and normalizing the haystack per document per
 * QUERY was ~20ms per query pass at a 4.2MB corpus (#8335); the scores it feeds are unchanged.
 */
const NORMALIZED_HAYSTACKS = new WeakMap<RecallDocument, string>()

export function normalizedHaystack(document: RecallDocument): string {
  const cached = NORMALIZED_HAYSTACKS.get(document)
  if (cached !== undefined) return cached
  const haystack = normalizeText(`${document.description}\n${document.body}`)
  NORMALIZED_HAYSTACKS.set(document, haystack)
  return haystack
}
