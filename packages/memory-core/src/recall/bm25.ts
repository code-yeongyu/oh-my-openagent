// Recall BM25 ranking: the alternative to the FTS-lite substring scorer that strategy.ts picks for
// CJK queries or corpora, and one half of the hybrid strategy for large corpora. Okapi BM25 over `description\nbody`, with a tokenizer
// that splits CJK runs (Hangul, Han, Kana) into character bigrams so an inflected Korean query word
// still meets the stored stem it shares a prefix with, without a morphological analyzer. Han characters
// (Chinese, Japanese kanji) are also terms on their own, because one character is often a whole word
// there. Terms are OR-scored and idf-weighted, so a rare planner term outranks a common one instead of
// the earliest substring position deciding the order.
//
// Approach adapted from birkin-mnemosyne (https://github.com/ashmoonori-afk/birkin-mnemosyne),
// a zero-dependency BM25 memory store with Korean-aware bigram tokenization.

import { type DocumentTerms, type DocumentTermsInput, recallBm25IndexFor, termCount } from "./bm25-index"
import { stemEnglishToken } from "./english-stem"
import type { RecallDocument } from "./provider"

const K1 = 1.5
const B = 0.75

// U+30FC (the Katakana-Hiragana prolonged sound mark) is Script=Common but belongs inside Kana runs.
export const CJK_CLASS = "\\p{Script=Hangul}\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30fc"
const TOKEN_PATTERN = new RegExp(`[${CJK_CLASS}]+|(?:(?![${CJK_CLASS}])[\\p{L}\\p{M}\\p{N}])+`, "gu")
const CJK_RUN = new RegExp(`^[${CJK_CLASS}]+$`, "u")
const HAN_CHARACTER = /^\p{Script=Han}$/u

/** True for a token that is exactly one Han character (Chinese hanzi, Japanese kanji, Korean hanja). */
export function isHanCharacter(token: string): boolean {
  return HAN_CHARACTER.test(token)
}

export interface RankedRecallDocument {
  readonly document: RecallDocument
  /** BM25 score; higher is better. Always positive for returned entries. */
  readonly score: number
  /** Set in a widened ranking on the documents that hold every unit of the queries. */
  readonly fullMatch?: true
}

interface RecallTokens {
  readonly tokens: string[]
  /** How many of the tokens are Han characters emitted next to the run that contains them. */
  readonly standaloneHanCharacters: number
}

interface RecallRun {
  /** The run itself, plus its character bigrams when it is a CJK run longer than two characters. */
  readonly pieces: string[]
  /** The Han characters of a CJK run longer than one character; they repeat text the pieces hold. */
  readonly hanCharacters: string[]
}

function splitRun(token: string): RecallRun {
  const pieces = [token]
  const characters = Array.from(token)
  if (characters.length < 2 || !CJK_RUN.test(token)) return { pieces, hanCharacters: [] }
  if (characters.length > 2) {
    for (let index = 0; index + 1 < characters.length; index += 1) {
      pieces.push(`${characters[index]}${characters[index + 1]}`)
    }
  }
  return { pieces, hanCharacters: characters.filter(isHanCharacter) }
}

function runs(text: string): RecallRun[] {
  return Array.from(text.normalize("NFKC").toLowerCase().matchAll(TOKEN_PATTERN), (match) => splitRun(match[0]))
}

function tokenize(text: string): RecallTokens {
  const tokens: string[] = []
  let standaloneHanCharacters = 0
  for (const { pieces, hanCharacters } of runs(text)) {
    // One push per token: a spread would pass a very long unbroken run as that many call arguments.
    for (const piece of pieces) tokens.push(piece)
    for (const character of hanCharacters) tokens.push(character)
    standaloneHanCharacters += hanCharacters.length
  }
  return { tokens, standaloneHanCharacters }
}

/**
 * NFKC-normalized, lowercased tokens: non-CJK letter/digit words as-is, CJK runs as the whole run plus
 * its character bigrams when the run is longer than two characters. NFKC composes NFD Hangul (common in
 * text pasted from macOS file names) and folds full-width Latin, so both sides meet on one form. Each
 * Han character of a run longer than one character is also emitted on its own, after the bigrams: a
 * Chinese word or a Japanese kanji word is often a single character, which no bigram isolates. Hangul
 * and kana characters are not, so a lone Hangul or kana character still only matches an identical lone
 * token, never a longer word.
 */
export function tokenizeRecallText(text: string): string[] {
  return tokenize(text).tokens
}

/** Index and query terms: the tokens with English suffixes folded, so both sides meet on one form. */
export function recallTerms(text: string): string[] {
  return tokenizeRecallText(text).map(stemEnglishToken)
}

/** A document's index terms and BM25 length: what the index and the persisted term store hold. */
export function recallDocumentTerms(document: RecallDocument): DocumentTermsInput {
  const { tokens, standaloneHanCharacters } = tokenize(`${document.description}\n${document.body}`)
  // The stand-alone Han characters repeat text the run and its bigrams already count. Leaving them out
  // keeps every length as it was, so planned queries that hold no Han character after NFKC rank and
  // score exactly as before.
  return { terms: tokens.map(stemEnglishToken), length: tokens.length - standaloneHanCharacters }
}

/**
 * Terms a caller adds to a search, by their distance from the query's own words. The caller is whoever
 * already writes the search (the Kibitzer sidecar model); nothing here calls a model or is stored.
 */
export interface RecallQueryExpansions {
  /** Close synonyms or other wordings of the query's key words. */
  readonly synonyms?: readonly string[]
  /** The topic in the user's other working languages. */
  readonly keywords?: readonly string[]
  /** Looser terms a note answering the question might contain. */
  readonly related?: readonly string[]
  /** One sentence written like a line of a note that would answer the question. */
  readonly noteLine?: string
}

/**
 * Weight of an added term; the query's own terms weigh 1.0. Chosen on the dev split of the
 * birkin-mnemosyne retrieval benchmark, where search-time expansion was first measured.
 */
export const RECALL_EXPANSION_WEIGHTS = { synonyms: 0.75, keywords: 0.75, related: 0.4, noteLine: 0.4 } as const

/**
 * The weight of each added term. A term the query already holds is left out, so an expansion never
 * counts a query word twice, and a term given in several tiers keeps its highest weight.
 */
export function recallExpansionWeights(
  expansions: RecallQueryExpansions | undefined,
  queryTerms: ReadonlySet<string>,
): Map<string, number> {
  const weights = new Map<string, number>()
  if (expansions === undefined) return weights
  const tiers: readonly (readonly [number, readonly string[]])[] = [
    [RECALL_EXPANSION_WEIGHTS.synonyms, expansions.synonyms ?? []],
    [RECALL_EXPANSION_WEIGHTS.keywords, expansions.keywords ?? []],
    [RECALL_EXPANSION_WEIGHTS.related, expansions.related ?? []],
    [RECALL_EXPANSION_WEIGHTS.noteLine, expansions.noteLine === undefined ? [] : [expansions.noteLine]],
  ]
  for (const [weight, texts] of tiers) {
    for (const term of texts.flatMap(recallTerms)) {
      if (!queryTerms.has(term) && weight > (weights.get(term) ?? 0)) weights.set(term, weight)
    }
  }
  return weights
}

/**
 * The units a note must all hold to count as a full match of the queries: every run and bigram. The
 * Han characters of a longer run are derived from it and do not count; one that stands alone does.
 */
function queryUnits(queries: readonly string[]): string[] {
  return [...new Set(queries.flatMap((query) => runs(query).flatMap((run) => run.pieces)).map(stemEnglishToken))]
}

/**
 * Documents sharing at least one token with the queries, best first; ties break on path. Queries are
 * planner output, so quoted phrases are scored as their individual words.
 *
 * With expansions, each added term scores as BM25 scaled by its weight, so a note found only through a
 * looser term ranks below one found through a closer term. A note that holds every unit of the queries
 * takes no expansion score and stays ahead of the notes an expansion found, in the order it has without
 * expansions: an exact lookup returns what it returns today. Without expansions nothing changes.
 */
export function rankRecallDocumentsBm25(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  expansions?: RecallQueryExpansions,
): RankedRecallDocument[] {
  const queryTerms = [...new Set(queries.flatMap(recallTerms))]
  if (queryTerms.length === 0 || documents.length === 0) return []

  const index = recallBm25IndexFor(documents, recallDocumentTerms)
  const averageLength = index.averageLength > 0 ? index.averageLength : 1
  const termScore = (id: number | undefined, terms: DocumentTerms): number => {
    if (id === undefined) return 0
    const frequency = termCount(terms, id)
    if (frequency === 0) return 0
    const length = terms.length
    const documentFrequency = index.documentFrequency[id] ?? 0
    const idf = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5))
    return (idf * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength))
  }
  const byScore = (left: RankedRecallDocument, right: RankedRecallDocument): number =>
    right.score - left.score || left.document.path.localeCompare(right.document.path)

  const added = [...recallExpansionWeights(expansions, new Set(queryTerms))].map(
    ([term, weight]) => [index.termId(term), weight] as const,
  )
  const queryIds = queryTerms.map(index.termId)
  const unitIds = added.length === 0 ? [] : queryUnits(queries).map(index.termId)
  const ranked: RankedRecallDocument[] = []
  const fullMatches: RankedRecallDocument[] = []
  documents.forEach((document, position) => {
    const terms = index.documents[position]
    if (terms === undefined) return
    let score = 0
    for (const id of queryIds) score += termScore(id, terms)
    if (added.length > 0) {
      if (unitIds.every((id) => id !== undefined && termCount(terms, id) > 0)) {
        fullMatches.push({ document, score })
        return
      }
      for (const [id, weight] of added) score += weight * termScore(id, terms)
    }
    if (score > 0) ranked.push({ document, score })
  })

  ranked.sort(byScore)
  if (fullMatches.length === 0) return ranked
  // Lifted by the best score an expansion reached, so the returned scores still descend.
  const lift = ranked[0]?.score ?? 0
  return [...fullMatches.sort(byScore).map(({ document, score }) => ({ document, score: score + lift, fullMatch: true as const })), ...ranked]
}
