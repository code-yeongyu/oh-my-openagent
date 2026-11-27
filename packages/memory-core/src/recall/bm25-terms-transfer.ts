// Moves document terms between the live BM25 index and a persisted store. It runs only in the lazily loaded
// store bundle and reaches the index through `RecallTermAccess`, so the ranking's own index is the one seeded.

import type { RecallTermAccess, RecallTermsSnapshot, StoredDocumentTerms } from "./bm25-index"
import type { RecallDocument } from "./provider"

/**
 * Adopts stored terms for documents that have none yet, so building their index tokenizes nothing.
 * Ids index `terms`; in a process whose dictionary is still empty they become the dictionary's ids
 * as they are, otherwise each document is moved onto the dictionary's ids and re-sorted.
 */
export function seedRecallDocumentTerms(
  access: RecallTermAccess,
  terms: readonly string[],
  entries: Iterable<readonly [RecallDocument, StoredDocumentTerms]>,
): void {
  const mapping = Uint32Array.from(terms, (term) => access.intern(term))
  const identity = mapping.every((id, position) => id === position)
  for (const [document, stored] of entries) access.adopt(document, identity ? stored : remap(stored, mapping))
}

function remap(stored: StoredDocumentTerms, mapping: Uint32Array): StoredDocumentTerms {
  const moved = (position: number): number => mapping[stored.ids[position] ?? 0] ?? 0
  const order = Array.from(stored.ids, (_, position) => position).sort((left, right) => moved(left) - moved(right))
  return {
    ids: Uint32Array.from(order, moved),
    counts: Uint32Array.from(order, (position) => stored.counts[position] ?? 0),
    length: stored.length,
  }
}

/**
 * The current terms of `documents` against a term list of only the terms they use, ids kept in
 * dictionary order so each document's ids stay ascending. `undefined` while any of them has no
 * current terms, as after a dictionary replacement before the next build.
 */
export function snapshotRecallDocumentTerms(
  access: RecallTermAccess,
  documents: readonly RecallDocument[],
): RecallTermsSnapshot | undefined {
  const encoded: StoredDocumentTerms[] = []
  for (const document of documents) {
    const terms = access.current(document)
    if (terms === undefined) return undefined
    encoded.push(terms)
  }
  const size = access.vocabularySize
  const compact = new Uint32Array(size)
  const used = new Uint8Array(size)
  for (const { ids } of encoded) for (const id of ids) used[id] = 1
  const terms: string[] = []
  used.forEach((flag, id) => {
    if (flag === 0) return
    compact[id] = terms.length
    terms.push(access.term(id) ?? "")
  })
  return {
    terms,
    documents: encoded.map(({ ids, counts, length }) => ({ ids: ids.map((id) => compact[id] ?? 0), counts, length })),
  }
}
