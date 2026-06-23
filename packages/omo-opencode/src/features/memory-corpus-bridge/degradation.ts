import type { L3RetrievalResult } from "./types"
import type { L3Router } from "./l3-router"

export interface DegradedL3SearchResult {
  results: L3RetrievalResult[]
  degraded: boolean
  reason?: string
}

export async function searchWithDegradation(
  router: L3Router,
  query: string,
  limit?: number,
): Promise<DegradedL3SearchResult> {
  try {
    const available = await router.isAvailable()
    if (!available) {
      return {
        results: [],
        degraded: true,
        reason: "L3 corpus unavailable (dst server unreachable or all providers down). Falling back to L2-only search.",
      }
    }
    const results = await router.search(query, limit)
    return { results, degraded: false }
  } catch (err) {
    return {
      results: [],
      degraded: true,
      reason: err instanceof Error ? err.message : "Unknown L3 error",
    }
  }
}
