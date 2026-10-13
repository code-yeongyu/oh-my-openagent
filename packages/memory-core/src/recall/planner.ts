// Recall query planner: turns newest-first conversation texts into a handful of
// short lexical queries for the AND-semantics FTS-lite scorer (search/query.ts).
// Every term AND every phrase of a query must substring-match a document, so
// queries stay tiny: two single terms (up to six when the memory's word rarity is known), plus quoted
// bigram phrases of adjacent kept terms (verbatim adjacency, never spanning a
// stopword). Pure and deterministic; the same input always yields the same
// queries.
//
// Tokenization is Unicode-aware (`\p{L}\p{N}`), matching the letta-derived
// scorer's language-neutral substring semantics: Hangul and other non-ASCII
// scripts plan recall exactly like English. ASCII terms keep the legacy 3-char
// noise floor; non-ASCII terms keep a 2-char floor because scripts like Korean
// pack a full content word into two syllables (e.g. 리콜, 검색).

import { recallDocumentFrequency, recallTerms } from "./bm25"
import type { RecallDocument } from "./provider"

const MAX_SINGLE_TERMS = 2
const MAX_TOOL_SINGLE_TERMS = 2
const MAX_PHRASES = 2
const MIN_ASCII_TERM_LENGTH = 3
const MIN_NON_ASCII_TERM_LENGTH = 2
const ASCII_ONLY = /^[\x00-\x7f]+$/
const PATH_LIKE = /\/|\.[a-z0-9]{1,6}$/i

const STOPWORDS: ReadonlySet<string> = new Set([
  "about", "after", "again", "all", "also", "always", "and", "any", "are", "arent",
  "back", "been", "before", "being", "both", "but", "by", "can", "cant", "come",
  "could", "couldnt", "did", "didnt", "do", "does", "doesnt", "doing", "done",
  "down", "each", "even", "few", "for", "from", "get", "gets", "getting", "give",
  "go", "going", "gonna", "got", "had", "hadnt", "has", "hasnt", "have", "havent",
  "having", "her", "here", "hers", "him", "his", "how", "i", "if", "im", "into",
  "is", "isnt", "it", "its", "ive", "just", "lets", "like", "look", "looking",
  "made", "make", "may", "me", "might", "more", "most", "much", "must", "my",
  "need", "next", "no", "not", "now", "of", "off", "on", "once", "only", "or",
  "other", "our", "out", "over", "own", "per", "please", "same", "see", "shall",
  "she", "should", "shouldnt", "so", "some", "still", "such", "sure", "than",
  "that", "thats", "the", "their", "them", "then", "there", "these", "they",
  "theyre", "this", "those", "through", "too", "under", "until", "up", "us",
  "use", "used", "using", "very", "via", "want", "was", "wasnt", "we", "well",
  "were", "werent", "what", "whats", "when", "where", "which", "while", "who",
  "why", "will", "with", "without", "wont", "would", "yes", "yet", "you",
  "your", "youre", "youve",
])

// Korean conversational fillers and function words. Particles/endings attached
// to a stem (메모리를, 플래너는) are NOT split off — that would need real
// morphology — so this list only covers tokens that appear standalone.
const KOREAN_STOPWORDS: ReadonlySet<string> = new Set([
  "거기", "거야", "그거", "그게", "그냥", "그러니까", "그러면", "그런데",
  "그래서", "그리고", "네", "누가", "뭐", "보자", "아니", "아니야", "어디",
  "어떻게", "왜", "응", "이거", "이게", "이제", "있어요", "저거", "저게",
  "저기", "정말", "좀", "진짜", "합니다", "하고", "했어", "했어요", "해줘",
  "해주세요",
])

// Ubiquitous command names harvested from tool args; they never occupy tool single slots.
const COMMAND_STOPWORDS: ReadonlySet<string> = new Set([
  "awk", "bash", "bun", "bunx", "cat", "cd", "cp", "curl", "echo", "env",
  "eval", "export", "false", "find", "git", "grep", "head", "jq", "ls",
  "mkdir", "mv", "node", "npm", "npx", "pnpm", "printf", "read", "rg",
  "rm", "sed", "set", "sh", "sort", "tail", "tee", "timeout", "true",
  "uniq", "wc", "xargs", "zsh",
])

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

function isKeptTerm(term: string): boolean {
  const minLength = ASCII_ONLY.test(term) ? MIN_ASCII_TERM_LENGTH : MIN_NON_ASCII_TERM_LENGTH
  return term.length >= minLength && !STOPWORDS.has(term) && !KOREAN_STOPWORDS.has(term)
}

interface TermRank {
  readonly term: string
  /** Index of the newest-first text that introduced the term (0 = newest). */
  readonly firstTextIndex: number
  /** How many of the provided texts contain the term; fewer is rarer. */
  readonly textCount: number
  /** First-occurrence position in the newest-first token stream. */
  readonly firstSequence: number
  readonly length: number
}

/**
 * How many memory notes hold each word, from the loaded corpus (recallTermRarity). Given it, the
 * planner picks the words that are rare in this memory instead of the longest ones.
 */
export interface RecallTermRarity {
  readonly documentFrequency: (term: string) => number
  readonly documentCount: number
}

/** Single-term queries when the planner knows the memory's word rarity. */
export const RARITY_SINGLE_TERMS = 6

const RARITY_CACHE = new WeakMap<readonly RecallDocument[], RecallTermRarity>()

/**
 * How many notes hold each planner word, read from the bm25 index's document frequencies (one
 * tokenization pass per corpus revision, shared with the ranking; nothing stored on disk). A word counts
 * by its own form first: stems fold ordinary words together ("presented" with "present") and would make
 * them look common. A word no note holds verbatim counts by the rarest unit bm25 indexes for it that some
 * note holds: an English inflection ("deployments") through its folded stem, a word with a particle or
 * ending attached ("메모리를") through its pieces.
 */
export function recallTermRarity(documents: readonly RecallDocument[]): RecallTermRarity {
  const cached = RARITY_CACHE.get(documents)
  if (cached !== undefined) return cached
  const { unitFrequency, surfaceFrequency, documentCount } = recallDocumentFrequency(documents)
  const documentFrequency = (term: string): number => {
    const whole = surfaceFrequency.get(term) ?? 0
    if (whole > 0) return whole
    const units = recallTerms(term).map((unit) => unitFrequency.get(unit) ?? 0).filter((count) => count > 0)
    return units.length === 0 ? 0 : Math.min(...units)
  }
  const rarity: RecallTermRarity = { documentFrequency, documentCount }
  RARITY_CACHE.set(documents, rarity)
  return rarity
}

/**
 * Whether most letters of the text are outside ASCII (Korean, Japanese, Chinese...). Such a message keeps
 * the length-ordered words: its words carry particles and endings, bm25 already meets them through their
 * pieces, and swapping them for rare words lost Korean questions in the public benchmark.
 */
function mostlyNonAsciiLetters(text: string | undefined): boolean {
  const letters = text?.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return false
  return letters.filter((letter) => !ASCII_ONLY.test(letter)).length * 2 > letters.length
}

export interface PlanRecallOptions {
  readonly toolTexts?: readonly string[]
  /** The memory's word rarity; omitted, the plan is the length-ordered plan. */
  readonly rarity?: RecallTermRarity
}

export function planRecallQueries(
  texts: readonly string[],
  options?: PlanRecallOptions,
): readonly string[] {
  const tokenLists = texts.map(tokenize)
  const rarity = options?.rarity === undefined || mostlyNonAsciiLetters(texts[0]) ? undefined : options.rarity
  const singles = rankedTerms(tokenLists, rarity)
    .slice(0, rarity === undefined ? MAX_SINGLE_TERMS : RARITY_SINGLE_TERMS)
    .map((entry) => entry.term)
  const toolTexts = options?.toolTexts
  if (toolTexts === undefined || toolTexts.length === 0) {
    return [...singles, ...planPhrases(tokenLists, rarity)].slice(0, singles.length + MAX_PHRASES)
  }

  const userSingles = new Set(singles)
  const toolTokenLists = toolTexts.map(tokenize)
  const pathDerived = pathDerivedTerms(toolTexts)
  const toolSingles = rankedTerms(toolTokenLists, rarity)
    .filter((entry) => !userSingles.has(entry.term) && !COMMAND_STOPWORDS.has(entry.term))
    .sort((left, right) => Number(pathDerived.has(right.term)) - Number(pathDerived.has(left.term)))
    .slice(0, MAX_TOOL_SINGLE_TERMS)
    .map((entry) => entry.term)

  return [...singles, ...toolSingles, ...planPhrases([...tokenLists, ...toolTokenLists], rarity)]
    .slice(0, singles.length + MAX_PHRASES + MAX_TOOL_SINGLE_TERMS)
}

function pathDerivedTerms(toolTexts: readonly string[]): ReadonlySet<string> {
  const terms = new Set<string>()
  for (const text of toolTexts) {
    if (!PATH_LIKE.test(text)) continue
    for (const term of tokenize(text)) terms.add(term)
  }
  return terms
}

function rankedTerms(tokenLists: readonly string[][], rarity?: RecallTermRarity): TermRank[] {
  const firstTextIndex = new Map<string, number>()
  const firstSequence = new Map<string, number>()
  const textCount = new Map<string, number>()
  let sequence = 0
  tokenLists.forEach((tokens, textIndex) => {
    for (const term of new Set(tokens)) {
      if (!firstTextIndex.has(term)) firstTextIndex.set(term, textIndex)
      textCount.set(term, (textCount.get(term) ?? 0) + 1)
    }
    for (const term of tokens) {
      if (!firstSequence.has(term)) firstSequence.set(term, sequence)
      sequence += 1
    }
  })

  const pool: TermRank[] = []
  const seen = new Set<string>()
  for (const tokens of tokenLists) {
    for (const term of tokens) {
      if (!isKeptTerm(term) || seen.has(term)) continue
      seen.add(term)
      pool.push({
        term,
        firstTextIndex: firstTextIndex.get(term) ?? 0,
        textCount: textCount.get(term) ?? 0,
        firstSequence: firstSequence.get(term) ?? 0,
        length: term.length,
      })
    }
  }

  if (rarity !== undefined) {
    // Words some note holds go first, rarest first; words no note holds keep the length order after them.
    // They are not dropped: the substring scorer can still meet them inside a longer word ("auth" in
    // "authentication"), so they take any slot the known words leave.
    const byPosition = (left: TermRank, right: TermRank): number => left.firstTextIndex - right.firstTextIndex
    const byLength = (left: TermRank, right: TermRank): number =>
      left.textCount - right.textCount || right.length - left.length || left.firstSequence - right.firstSequence
    const known = pool.filter((entry) => rarity.documentFrequency(entry.term) > 0)
      .sort((left, right) => byPosition(left, right) || rarity.documentFrequency(left.term) - rarity.documentFrequency(right.term) || byLength(left, right))
    const unknown = pool.filter((entry) => rarity.documentFrequency(entry.term) === 0)
      .sort((left, right) => byPosition(left, right) || byLength(left, right))
    return [...known, ...unknown]
  }
  return pool.sort(
    (left, right) =>
      left.firstTextIndex - right.firstTextIndex
      || left.textCount - right.textCount
      || right.length - left.length
      || left.firstSequence - right.firstSequence,
  )
}

/** Quoted bigram phrases from the newest text that has a verbatim kept pair. */
function planPhrases(tokenLists: readonly string[][], rarity?: RecallTermRarity): string[] {
  const phrases: string[] = []
  const seen = new Set<string>()
  // With rarity, a phrase needs each of its words held by some note.
  const known = (term: string): boolean => rarity === undefined || rarity.documentFrequency(term) > 0
  for (const tokens of tokenLists) {
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const left = tokens[index]
      const right = tokens[index + 1]
      if (left === undefined || right === undefined) continue
      if (!isKeptTerm(left) || !isKeptTerm(right) || !known(left) || !known(right)) continue
      const phrase = `${left} ${right}`
      if (seen.has(phrase)) continue
      seen.add(phrase)
      phrases.push(`"${phrase}"`)
    }
    if (phrases.length > 0) break
  }
  return phrases.slice(0, MAX_PHRASES)
}
