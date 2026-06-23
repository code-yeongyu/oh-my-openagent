// Advanced Retrieval — Mem0 Pro features
// Combinable: rerank (ZeroEntropy, +150ms) + keyword_search (BM25, +10ms) + filter_memories (+250ms precision)
// All three can be combined on a single search call

export interface AdvancedRetrievalOptions {
  rerank: boolean
  keyword_search: boolean
  filter_memories: boolean
}

export const RETRIEVAL_PRESETS = {
  fast: {
    rerank: false,
    keyword_search: false,
    filter_memories: false,
  },
  balanced: {
    rerank: true,
    keyword_search: false,
    filter_memories: false,
  },
  recall: {
    rerank: true,
    keyword_search: true,
    filter_memories: false,
  },
  precision: {
    rerank: true,
    keyword_search: true,
    filter_memories: true,
  },
} as const satisfies Record<string, AdvancedRetrievalOptions>

export type RetrievalPreset = keyof typeof RETRIEVAL_PRESETS

const RERANK_OVERHEAD_MS = 150
const KEYWORD_SEARCH_OVERHEAD_MS = 10
const FILTER_MEMORIES_OVERHEAD_MS = 250

/**
 * Get the estimated latency overhead for an advanced retrieval config (in ms).
 * Estimate based on Mem0 documentation:
 *   rerank (ZeroEntropy): +150ms
 *   keyword_search (BM25): +10ms
 *   filter_memories (precision): +250ms
 */
export function estimateLatencyOverhead(options: AdvancedRetrievalOptions): number {
  return (
    (options.rerank ? RERANK_OVERHEAD_MS : 0) +
    (options.keyword_search ? KEYWORD_SEARCH_OVERHEAD_MS : 0) +
    (options.filter_memories ? FILTER_MEMORIES_OVERHEAD_MS : 0)
  )
}

export function buildAdvancedRetrievalParams(options: AdvancedRetrievalOptions): Record<string, boolean> {
  return {
    rerank: options.rerank,
    keyword_search: options.keyword_search,
    filter_memories: options.filter_memories,
  }
}

export function getRetrievalPreset(preset: RetrievalPreset | string): AdvancedRetrievalOptions {
  if (preset in RETRIEVAL_PRESETS) {
    return { ...RETRIEVAL_PRESETS[preset as RetrievalPreset] }
  }
  return { ...RETRIEVAL_PRESETS.balanced }
}
