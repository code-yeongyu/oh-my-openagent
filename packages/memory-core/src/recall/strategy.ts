// Recall strategy selection. There is no user-facing ranker setting: the retriever picks how to rank
// candidates from the planned queries and the corpus, and the Kibitzer judge downstream keeps
// precision. The retriever therefore leans toward recall.
//
//   - substring: the FTS-lite AND scorer. Kept for English-only queries over a corpus below both
//     thresholds, so an English-only user sees exactly the candidates they saw before.
//   - bm25: OR-scored BM25 with CJK bigrams, when any planned query contains a CJK character or the
//     corpus is at least CJK_CORPUS_MIN_SHARE CJK by letter count. Substring AND matching misses
//     inflected Korean and unsegmented Japanese/Chinese text entirely.
//   - hybrid: substring and bm25 fused by reciprocal rank, when the corpus has at least
//     LARGE_CORPUS_MIN_DOCUMENTS notes. It takes precedence over bm25 because its bm25 half already
//     carries the CJK bigrams.
//
// The thresholds come from recall-ranker-bench.mjs (packages/omo-senpi/scripts/qa).

import { CJK_CLASS } from "./bm25"
import { normalizedHaystack } from "./haystack"
import type { RecallDocument } from "./provider"

export type RecallStrategy = "substring" | "bm25" | "hybrid"

/** Share of CJK code points among all letter code points at which the corpus counts as CJK. */
export const CJK_CORPUS_MIN_SHARE = 0.1
/** Note count at which the corpus counts as large. */
export const LARGE_CORPUS_MIN_DOCUMENTS = 200

const CJK_CHARACTER = new RegExp(`[${CJK_CLASS}]`, "u")
const CJK_CHARACTERS = new RegExp(`[${CJK_CLASS}]`, "gu")
const LETTERS = new RegExp(`[\\p{L}${CJK_CLASS}]`, "gu")

/**
 * Per document array, so the scan runs once per corpus revision like the other recall memos. The array
 * must not be mutated after it is first measured: an in-place change keeps the stale share.
 * RecallCorpusCache hands out a fresh array per revision.
 */
const CJK_SHARES = new WeakMap<readonly RecallDocument[], number>()

export function hasCjk(text: string): boolean {
  return CJK_CHARACTER.test(text)
}

export function corpusCjkShare(documents: readonly RecallDocument[]): number {
  const cached = CJK_SHARES.get(documents)
  if (cached !== undefined) return cached
  let cjk = 0
  let letters = 0
  for (const document of documents) {
    const text = normalizedHaystack(document)
    cjk += text.match(CJK_CHARACTERS)?.length ?? 0
    letters += text.match(LETTERS)?.length ?? 0
  }
  const share = letters === 0 ? 0 : cjk / letters
  CJK_SHARES.set(documents, share)
  return share
}

export function chooseRecallStrategy(documents: readonly RecallDocument[], queries: readonly string[]): RecallStrategy {
  if (documents.length >= LARGE_CORPUS_MIN_DOCUMENTS) return "hybrid"
  if (queries.some(hasCjk) || corpusCjkShare(documents) >= CJK_CORPUS_MIN_SHARE) return "bm25"
  return "substring"
}
