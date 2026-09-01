// Recall query planner: turns newest-first conversation texts into a handful of
// short lexical queries for the AND-semantics FTS-lite scorer (search/query.ts).
// Every term AND every phrase of a query must substring-match a document, so
// queries stay tiny: one or two distinctive single terms, plus quoted bigram
// phrases of adjacent kept terms (verbatim adjacency, never spanning a
// stopword). Pure and deterministic; the same input always yields the same
// queries.

export const MAX_RECALL_QUERIES = 4

const MAX_SINGLE_TERMS = 2
const MAX_PHRASES = 2
const MIN_TERM_LENGTH = 3

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

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function isKeptTerm(term: string): boolean {
  return term.length >= MIN_TERM_LENGTH && !STOPWORDS.has(term)
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

export function planRecallQueries(texts: readonly string[]): readonly string[] {
  const tokenLists = texts.map(tokenize)

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

  const singles = pool
    .sort(
      (left, right) =>
        left.firstTextIndex - right.firstTextIndex
        || left.textCount - right.textCount
        || right.length - left.length
        || left.firstSequence - right.firstSequence,
    )
    .slice(0, MAX_SINGLE_TERMS)
    .map((entry) => entry.term)

  return [...singles, ...planPhrases(tokenLists)].slice(0, MAX_RECALL_QUERIES)
}

/** Quoted bigram phrases from the newest text that has a verbatim kept pair. */
function planPhrases(tokenLists: readonly string[][]): string[] {
  const phrases: string[] = []
  const seen = new Set<string>()
  for (const tokens of tokenLists) {
    for (let index = 0; index + 1 < tokens.length; index += 1) {
      const left = tokens[index]
      const right = tokens[index + 1]
      if (left === undefined || right === undefined) continue
      if (!isKeptTerm(left) || !isKeptTerm(right)) continue
      const phrase = `${left} ${right}`
      if (seen.has(phrase)) continue
      seen.add(phrase)
      phrases.push(`"${phrase}"`)
    }
    if (phrases.length > 0) break
  }
  return phrases.slice(0, MAX_PHRASES)
}
