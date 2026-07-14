import type { Database } from "../db/sqlite"
import type { Embedder } from "../embedding/provider"
import type { SearchQuery, SearchResult } from "./types"
import { searchMemory } from "./sources/memory-searcher"
import { searchCompartment } from "./sources/compartment-searcher"
import { searchCommit } from "./sources/commit-searcher"
import { searchMessage } from "./sources/message-searcher"
import { searchNote } from "./sources/note-searcher"
import { mergeResults } from "./unified"

export interface SearchEngine {
  search(query: SearchQuery): Promise<SearchResult[]>
}

export function createSearchEngine(
  db: Database,
  embedder: Embedder,
): SearchEngine {
  return { search }

  async function search(query: SearchQuery): Promise<SearchResult[]> {
    const trimmedQuery = query.text.trim()
    if (trimmedQuery.length === 0) return []

    const limit = query.limit ?? 10
    const threshold = query.threshold ?? 0

    const needsEmbedding = !query.semanticOnly

    const queryEmbedding: Float32Array | null = needsEmbedding
      ? await embedder.embedText(trimmedQuery).catch(() => null)
      : null

    const sourceFns = [
      searchMemory,
      searchCompartment,
      searchCommit,
      searchMessage,
      searchNote,
    ] as const

    const results = await Promise.all(
      sourceFns.map((fn) =>
        fn(db, queryEmbedding ?? new Float32Array(), query).catch(() => [] as SearchResult[]),
      ),
    )

    return mergeResults(results, { limit, threshold, diversify: true })
  }
}
