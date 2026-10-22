// Compact BM25 index storage. A per-document Map<string, number> kept every term string once per
// document that held it: at 6,405 notes that was ~229 MB of heap per session, and every HEAD move
// (each memory write) rebuilt all of it. Terms are interned to ids in one process-wide dictionary,
// each document keeps two sorted typed arrays, and those arrays are cached per document object, which
// RecallCorpusCache reuses across HEAD moves for every unchanged blob. A rebuild therefore tokenizes
// only the changed notes and recounts document frequency from the cached arrays. A new process can
// also take a document's arrays from the persisted term store (bm25-store.ts) instead of tokenizing it.

import type { RecallDocument } from "./provider"

export interface DocumentTermsInput {
  readonly terms: readonly string[]
  readonly length: number
}

/** One document's terms outside the process dictionary: ids index a term list the holder carries. */
export interface StoredDocumentTerms {
  /** Term ids, ascending. */
  readonly ids: Uint32Array
  readonly counts: Uint32Array
  readonly length: number
}

export interface DocumentTerms extends StoredDocumentTerms {
  readonly generation: number
}

/** Documents' terms against a compact term list holding exactly the terms they use. */
export interface RecallTermsSnapshot {
  readonly terms: readonly string[]
  readonly documents: readonly StoredDocumentTerms[]
}

export interface RecallBm25Index {
  readonly generation: number
  readonly documents: readonly DocumentTerms[]
  readonly documentFrequency: Uint32Array
  readonly averageLength: number
  /** The id of a term any indexed document holds; `undefined` when no document holds it. */
  readonly termId: (term: string) => number | undefined
}

/**
 * Terms no live index holds still keep their ids, so the dictionary is replaced once it holds more
 * than twice the live vocabulary plus this slack; every cached document is then re-read once. The live
 * vocabulary is the largest of the last RECENT_BUILDS builds, so a host that ranks two memories in
 * turn (one per agent) does not replace the dictionary on every switch.
 */
const DICTIONARY_SLACK = 65_536
const RECENT_BUILDS = 8
const recentLive: number[] = []

let generation = 0
let dictionary = new Map<string, number>()
let vocabulary: string[] = []
const DOCUMENT_TERMS = new WeakMap<RecallDocument, DocumentTerms>()
const INDEXES = new WeakMap<readonly RecallDocument[], RecallBm25Index>()
const ENCODED_LISTENERS = new WeakMap<readonly RecallDocument[], () => void>()

function intern(term: string): number {
  const known = dictionary.get(term)
  if (known !== undefined) return known
  const id = dictionary.size
  dictionary.set(term, id)
  vocabulary.push(term)
  return id
}

function encode(input: DocumentTermsInput): DocumentTerms {
  const counts = new Map<number, number>()
  for (const term of input.terms) {
    const id = intern(term)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const ids = Uint32Array.from(counts.keys()).sort()
  const ordered = new Uint32Array(ids.length)
  ids.forEach((id, position) => {
    ordered[position] = counts.get(id) ?? 0
  })
  return { generation, ids, counts: ordered, length: input.length }
}

function currentTerms(document: RecallDocument): DocumentTerms | undefined {
  const cached = DOCUMENT_TERMS.get(document)
  return cached !== undefined && cached.generation === generation ? cached : undefined
}

function build(documents: readonly RecallDocument[], read: (document: RecallDocument) => DocumentTermsInput): RecallBm25Index {
  let fresh = 0
  const encoded = documents.map((document) => {
    const cached = currentTerms(document)
    if (cached !== undefined) return cached
    fresh += 1
    const terms = encode(read(document))
    DOCUMENT_TERMS.set(document, terms)
    return terms
  })
  const documentFrequency = new Uint32Array(dictionary.size)
  let live = 0
  let totalLength = 0
  for (const terms of encoded) {
    totalLength += terms.length
    for (const id of terms.ids) {
      if (documentFrequency[id] === 0) live += 1
      documentFrequency[id] = (documentFrequency[id] ?? 0) + 1
    }
  }
  recentLive.push(live)
  if (recentLive.length > RECENT_BUILDS) recentLive.shift()
  if (dictionary.size > 2 * Math.max(...recentLive) + DICTIONARY_SLACK) {
    generation += 1
    dictionary = new Map()
    vocabulary = []
    recentLive.length = 0
    return build(documents, read)
  }
  if (fresh > 0) ENCODED_LISTENERS.get(documents)?.()
  const terms = dictionary
  return {
    generation,
    documents: encoded,
    documentFrequency,
    averageLength: documents.length === 0 ? 0 : totalLength / documents.length,
    termId: (term) => {
      const id = terms.get(term)
      return id !== undefined && (documentFrequency[id] ?? 0) > 0 ? id : undefined
    },
  }
}

/**
 * One index per document array. RecallCorpusCache hands out the same array for as long as HEAD has
 * not moved, so the index is built once per corpus revision and a moved HEAD (a fresh array) drops it.
 * The array must not be mutated after it is first ranked: an in-place change keeps the stale index.
 */
export function recallBm25IndexFor(
  documents: readonly RecallDocument[],
  read: (document: RecallDocument) => DocumentTermsInput,
): RecallBm25Index {
  const cached = INDEXES.get(documents)
  if (cached !== undefined && cached.generation === generation) return cached
  const index = build(documents, read)
  INDEXES.set(documents, index)
  return index
}

export function termCount(terms: DocumentTerms, id: number): number {
  let low = 0
  let high = terms.ids.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const value = terms.ids[middle] ?? 0
    if (value === id) return terms.counts[middle] ?? 0
    if (value < id) low = middle + 1
    else high = middle - 1
  }
  return 0
}

/**
 * Calls `listener` after an index of `documents` is built that had to tokenize at least one of them,
 * so a holder of a persisted copy (bm25-persist.ts) knows that copy is missing documents.
 */
export function onRecallDocumentsEncoded(documents: readonly RecallDocument[], listener: () => void): void {
  ENCODED_LISTENERS.set(documents, listener)
}

/**
 * The index internals a persisted store needs to seed and snapshot document terms. The store loads lazily in its
 * own bundle (bm25-terms-transfer.ts holds the logic); only these accessors live with the index.
 */
export interface RecallTermAccess {
  current(document: RecallDocument): DocumentTerms | undefined
  /** Sets `document`'s terms from a store when it has none in the current generation. */
  adopt(document: RecallDocument, stored: StoredDocumentTerms): void
  intern(term: string): number
  term(id: number): string | undefined
  readonly vocabularySize: number
}

export const recallTermAccess: RecallTermAccess = {
  current: currentTerms,
  adopt(document, stored) {
    if (currentTerms(document) === undefined) DOCUMENT_TERMS.set(document, { generation, ...stored })
  },
  intern,
  term: (id) => vocabulary[id],
  get vocabularySize() {
    return vocabulary.length
  },
}
