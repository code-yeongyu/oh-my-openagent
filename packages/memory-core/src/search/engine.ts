// FTS-lite search core: full scan over a transcript provider, letta-exact ranking.
//
// Mirrors letta-code src/backend/local/transcript-search.ts:393-461 (searchLocalTranscriptMessages):
// no index, score ascending, date descending as tie-break, default limit 100,
// hidden conversations excluded unless includeHidden.

import { type SearchDocument, dateInRange, matchScore, parseQuery, searchableText } from "./query"

export interface TranscriptConversation {
  id: string
  /** Hidden conversations are skipped unless the caller opts in. */
  hidden?: boolean
  messages: readonly SearchDocument[]
}

/** Source of transcripts; implemented per harness (see SenpiSessionProvider). */
export interface TranscriptProvider {
  listConversations(): readonly TranscriptConversation[]
}

export interface SearchOptions {
  /** Maximum results; defaults to 100, zero or negative yields nothing. */
  limit?: number
  conversationId?: string
  /** Inclusive ISO lower bound. */
  startDate?: string
  /** Inclusive ISO upper bound. */
  endDate?: string
  includeHidden?: boolean
}

export interface SearchResult {
  messageId: string
  conversationId: string
  createdAt: string
  score: number
  document: SearchDocument
}

const DEFAULT_LIMIT = 100
const EPOCH = new Date(0).toISOString()

interface ScoredDocument {
  document: SearchDocument
  score: number
}

export function searchTranscripts(
  provider: TranscriptProvider,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const queryText = query.trim()
  if (!queryText) return []

  const parsed = parseQuery(queryText)
  if (parsed.terms.length === 0 && parsed.phrases.length === 0) return []

  const limit = Math.max(0, options.limit ?? DEFAULT_LIMIT)
  if (limit === 0) return []

  const scored: ScoredDocument[] = []
  for (const conversation of provider.listConversations()) {
    if (conversation.hidden === true && options.includeHidden !== true) continue
    if (options.conversationId && conversation.id !== options.conversationId) continue

    for (const document of conversation.messages) {
      const score = matchScore(searchableText(document), parsed)
      if (score === null) continue
      if (!dateInRange(document.date, options.startDate, options.endDate)) continue
      scored.push({ document, score })
    }
  }

  return scored
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score
      return (right.document.date ?? "").localeCompare(left.document.date ?? "")
    })
    .slice(0, limit)
    .map(toSearchResult)
}

function toSearchResult(entry: ScoredDocument): SearchResult {
  return {
    messageId: entry.document.id,
    conversationId: entry.document.conversationId,
    createdAt: entry.document.date ?? EPOCH,
    score: entry.score,
    document: entry.document,
  }
}
