// Recall candidate selection: scores recall documents against the planned
// queries with the strategy chooseRecallStrategy picks (strategy.ts). The
// substring path is the FTS-lite AND-semantics scorer and keeps the best hit per
// path. matchScore is reused over a description+body haystack (the SearchDocument
// projection does not fit recall files, so the haystack is composed directly).

import { matchScoreNormalized, normalizeText, parseQuery, type ParsedQuery } from "../search"
import {
  isHanCharacter,
  rankRecallDocumentsBm25,
  recallExpansionWeights,
  recallTerms,
  tokenizeRecallText,
  type RecallQueryExpansions,
} from "./bm25"
import { normalizedHaystack } from "./haystack"
import type { RecallDocument } from "./provider"
import { chooseRecallStrategy, hasCjk, type RecallStrategy } from "./strategy"

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
  /** Additional paths to skip, such as memories already visible in the transcript. Empty when omitted. */
  readonly excludePaths?: ReadonlySet<string>
  /** Internal override for tests and the benchmark; chosen by chooseRecallStrategy when omitted. */
  readonly strategy?: RecallStrategy
  /**
   * Terms the caller adds to this search, scored below the queries' own words (bm25.ts). Omitted or
   * empty, the selection is exactly what it is without the option.
   */
  readonly expansions?: RecallQueryExpansions
}

export { RECALL_EXPANSION_WEIGHTS, type RecallQueryExpansions } from "./bm25"

/** Reciprocal rank fusion constant (Cormack et al.); 60 is the customary value. */
const RRF_K = 60

function expansionTexts(expansions: RecallQueryExpansions | undefined): string[] {
  if (expansions === undefined) return []
  return [
    ...(expansions.synonyms ?? []),
    ...(expansions.keywords ?? []),
    ...(expansions.related ?? []),
    ...(expansions.noteLine === undefined ? [] : [expansions.noteLine]),
  ].filter((text) => text.trim() !== "")
}

export function selectRecallCandidates(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  options: SelectRecallOptions,
): RecallCandidate[] {
  const maxItems = Math.max(0, options.maxItems)
  const parsedQueries = queries.map(parseQuery).filter((query) => query.terms.length > 0 || query.phrases.length > 0)
  if (maxItems === 0 || parsedQueries.length === 0) return []
  const strategy = options.strategy ?? chooseRecallStrategy(documents, queries)
  const unwidened = rankByStrategy(documents, queries, parsedQueries, options, strategy)
  if (!addsTerms(queries, options.expansions)) return unwidened.slice(0, maxItems)
  return widenCandidates(documents, queries, parsedQueries, options, strategy, unwidened).slice(0, maxItems)
}

/**
 * Whether the expansions add a term the queries do not already hold. Expansions that only repeat query
 * words, or hold no letter or digit, add nothing: the search is then the search as written.
 */
function addsTerms(queries: readonly string[], expansions: RecallQueryExpansions | undefined): boolean {
  if (expansionTexts(expansions).length === 0) return false
  return recallExpansionWeights(expansions, new Set(queries.flatMap(recallTerms))).size > 0
}

/** Every candidate of the search as written, best first; callers apply the cap. */
function rankByStrategy(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  parsedQueries: readonly ParsedQuery[],
  options: SelectRecallOptions,
  strategy: RecallStrategy,
): RecallCandidate[] {
  if (strategy === "bm25") return rankBm25(documents, queries, options, undefined).candidates
  if (strategy === "hybrid") return pinPhraseLeader(
    fuseCandidates(rankSubstringCandidates(documents, parsedQueries, options), rankBm25(documents, queries, options, undefined).candidates),
    phraseLeaderPath(documents, parsedQueries, options),
  )
  return rankSubstringCandidates(documents, parsedQueries, options)
}

/**
 * A widened search. The notes that hold every word of the queries - every unit for bm25, every term
 * verbatim for the substring scorer - come first, in the order the search has without added terms, so
 * an exact lookup returns what it returns today. Every other note follows in the widened bm25 order,
 * where each added term counts for its weight. The substring scorer has no score a weight could apply
 * to, which is why the added terms reach a small English memory through bm25 as well. The score keeps
 * the contract (ascending) as a function of the final rank, like the fused hybrid score.
 */
function widenCandidates(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  parsedQueries: readonly ParsedQuery[],
  options: SelectRecallOptions,
  strategy: RecallStrategy,
  unwidened: readonly RecallCandidate[],
): RecallCandidate[] {
  const widened = rankBm25(documents, queries, options, options.expansions)
  const holdsEveryWord = new Set(widened.fullMatches)
  if (strategy !== "bm25") {
    for (const candidate of rankSubstringCandidates(documents, parsedQueries, options)) holdsEveryWord.add(candidate.path)
  }
  const kept = unwidened.filter((candidate) => holdsEveryWord.has(candidate.path))
  const keptPaths = new Set(kept.map((candidate) => candidate.path))
  return [...kept, ...widened.candidates.filter((candidate) => !keptPaths.has(candidate.path))]
    .map((candidate, rank) => ({ ...candidate, score: 1 / (1 + 1 / (RRF_K + rank + 1)) }))
}

function isExcluded(path: string, options: SelectRecallOptions): boolean {
  return options.surfaced.has(path) || options.excludePaths?.has(path) === true
}

/** Every substring match after exclusions, best first; callers apply the cap. */
function rankSubstringCandidates(
  documents: readonly RecallDocument[],
  parsedQueries: readonly ParsedQuery[],
  options: SelectRecallOptions,
): RecallCandidate[] {
  const queryTerms = collectQueryTerms(parsedQueries)
  const scored: RecallCandidate[] = []
  for (const document of documents) {
    if (isExcluded(document.path, options)) continue

    const haystack = normalizedHaystack(document)
    let best: number | null = null
    for (const parsed of parsedQueries) {
      const score = matchScoreNormalized(haystack, parsed)
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

  return scored.sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
}

/**
 * BM25 path, every match after exclusions, best first. The score keeps the RecallCandidate contract
 * (ascending, lower is better) as 1 / (1 + bm25), and the excerpt centers on the first query token the
 * body actually contains, so a bigram hit inside a longer Korean word still anchors the window.
 */
function rankBm25(
  documents: readonly RecallDocument[],
  queries: readonly string[],
  options: SelectRecallOptions,
  expansions: RecallQueryExpansions | undefined,
): { readonly candidates: RecallCandidate[]; readonly fullMatches: string[] } {
  // One-character tokens (a lone CJK syllable, a version digit) match almost anywhere and would drag the window.
  // A Han character is a ranking term of its own, so it anchors the window only when no longer token does.
  const tokens = [...new Set(queries.flatMap(tokenizeRecallText))]
  const queryTokens = tokens.filter((token) => Array.from(token).length > 1)
  const hanCharacters = tokens.filter(isHanCharacter)
  // A note found only through an added term shows the passage that term matched, not the body head;
  // the same order as for the query's own tokens, longer tokens before single Han characters.
  const added = [...new Set(expansionTexts(expansions).flatMap(tokenizeRecallText))]
  const addedTokens = added.filter((token) => Array.from(token).length > 1)
  const addedHanCharacters = added.filter(isHanCharacter)
  const candidates: RecallCandidate[] = []
  const fullMatches: string[] = []
  for (const { document, score, fullMatch } of rankRecallDocumentsBm25(documents, queries, expansions)) {
    if (isExcluded(document.path, options)) continue
    if (fullMatch === true) fullMatches.push(document.path)
    candidates.push({
      path: document.path,
      description: document.description,
      // The tokens are NFKC, so the window is searched in the NFKC body to stay anchored.
      excerpt: buildExcerpt(document.body.normalize("NFKC"), queryTokens, hanCharacters, addedTokens, addedHanCharacters),
      score: 1 / (1 + score),
    })
  }
  return { candidates, fullMatches }
}

/**
 * Hybrid path: reciprocal rank fusion of the bm25 ranking with the substring matches, so a note either
 * ranker finds stays in the pool and a note both find rises to the top. The substring order is the
 * offset of the first match, not relevance, so every substring match votes as if ranked first instead
 * of by its position; on the padded benchmark corpora rank-weighted substring votes pushed filler
 * notes above the answer. That flat vote equals the vote of bm25's first place, so fused ties break
 * on the bm25 rank (a note bm25 does not rank sorts after one it does) and only then on the path. A
 * note keeps its substring excerpt when it has one. The score keeps the contract as 1 / (1 + fused).
 */
function fuseCandidates(substring: readonly RecallCandidate[], bm25: readonly RecallCandidate[]): RecallCandidate[] {
  const fused = new Map<string, { candidate: RecallCandidate; weight: number; bm25Rank: number }>()
  const vote = (candidate: RecallCandidate, weight: number, bm25Rank: number): void => {
    const entry = fused.get(candidate.path)
    if (entry === undefined) fused.set(candidate.path, { candidate, weight, bm25Rank })
    else {
      entry.weight += weight
      entry.bm25Rank = Math.min(entry.bm25Rank, bm25Rank)
    }
  }
  for (const candidate of substring) vote(candidate, 1 / (RRF_K + 1), Number.POSITIVE_INFINITY)
  bm25.forEach((candidate, rank) => vote(candidate, 1 / (RRF_K + rank + 1), rank))
  return [...fused.values()]
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        left.bm25Rank - right.bm25Rank ||
        left.candidate.path.localeCompare(right.candidate.path),
    )
    .map(({ candidate, weight }) => ({ ...candidate, score: 1 / (1 + weight) }))
}

function isNonCjkMultiWord(parsed: ParsedQuery): boolean {
  const multiWord = parsed.terms.length + parsed.phrases.length > 1 || parsed.phrases.some((phrase) => /\s/.test(phrase.trim()))
  return multiWord && !hasCjk([...parsed.terms, ...parsed.phrases].join(" "))
}

/**
 * The note today's substring ranker puts first among matches of the non-CJK multi-word planned queries
 * (quoted phrases, or several words that must all appear): an exact phrase is the strongest lexical
 * evidence recall has, and the flat substring vote in fuseCandidates cannot tell it from a lone-word
 * hit. CJK queries are left to fusion, since substring matching is what fails on inflected Korean.
 */
function phraseLeaderPath(
  documents: readonly RecallDocument[],
  parsedQueries: readonly ParsedQuery[],
  options: SelectRecallOptions,
): string | undefined {
  const multiWord = parsedQueries.filter(isNonCjkMultiWord)
  if (multiWord.length === 0) return undefined
  let leader: { path: string; score: number } | undefined
  for (const document of documents) {
    if (isExcluded(document.path, options)) continue
    const haystack = normalizedHaystack(document)
    for (const parsed of multiWord) {
      const score = matchScoreNormalized(haystack, parsed)
      if (score === null) continue
      if (leader === undefined || score < leader.score || (score === leader.score && document.path.localeCompare(leader.path) < 0)) {
        leader = { path: document.path, score }
      }
    }
  }
  return leader?.path
}

/**
 * Substring floor for the hybrid: the phrase leader keeps the first place it holds today, so fusion can
 * only add notes around it and never demote the note an exact phrase found. It takes the first place's
 * score so the list stays ascending.
 */
function pinPhraseLeader(fused: readonly RecallCandidate[], leaderPath: string | undefined): RecallCandidate[] {
  const leader = fused.find((candidate) => candidate.path === leaderPath)
  const first = fused[0]
  if (leader === undefined || first === undefined || leader === first) return [...fused]
  return [{ ...leader, score: first.score }, ...fused.filter((candidate) => candidate !== leader)]
}

function collectQueryTerms(parsedQueries: readonly ParsedQuery[]): string[] {
  const terms: string[] = []
  for (const parsed of parsedQueries) {
    terms.push(...parsed.terms)
    for (const phrase of parsed.phrases) terms.push(...phrase.split(/\s+/).filter(Boolean))
  }
  return terms
}

/**
 * Excerpt is a body region centered on the first query-term match, or the body
 * head when no query term matches the body. Each list of fallback terms is searched
 * only when no earlier list matches. Whitespace is collapsed to single spaces and the
 * result never exceeds EXCERPT_CHARS.
 */
function buildExcerpt(body: string, terms: readonly string[], ...fallbackTerms: readonly (readonly string[])[]): string {
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
