// The opt-in cross-language rerank ships in the recall-store sidecar (`#omo-recall-store-runtime`), so omo.js carries
// none of it; it is imported only when memory.recall.crosslingual is enabled.

import type { createCrosslingualReranker } from "./recall-crosslingual"

export interface CrosslingualRuntime {
  readonly createCrosslingualReranker: typeof createCrosslingualReranker
}

/** One shared import per process; a failed import is not cached, so a later wake retries. */
export function createCrosslingualRuntimeLoader(importRuntime: () => Promise<CrosslingualRuntime>): () => Promise<CrosslingualRuntime> {
  let pending: Promise<CrosslingualRuntime> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      throw error
    })
    return pending
  }
}

export const loadCrosslingualRuntime = createCrosslingualRuntimeLoader(() => import("#omo-recall-store-runtime"))
