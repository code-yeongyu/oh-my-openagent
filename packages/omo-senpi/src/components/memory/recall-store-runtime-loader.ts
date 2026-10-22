// The persisted recall terms (store codec, persistence, save gate) are read on the first corpus load, not
// at extension load, so they ship as the `#omo-recall-store-runtime` sidecar and stay out of omo.js.

import type { RecallTermStoreModule } from "@oh-my-opencode/memory-core"

export const RECALL_STORE_RUNTIME_ARTIFACT = "extensions/omo-recall-store.js"

/** One shared import per process; a failed import is not cached, so the next corpus load retries. */
export function createRecallStoreRuntimeLoader(importRuntime: () => Promise<RecallTermStoreModule>): () => Promise<RecallTermStoreModule> {
  let pending: Promise<RecallTermStoreModule> | undefined
  return () => {
    pending ??= importRuntime().catch((error: unknown) => {
      pending = undefined
      const cause = error instanceof Error ? error.message : String(error)
      throw new Error(`The persisted recall terms are unavailable: ${RECALL_STORE_RUNTIME_ARTIFACT} failed to load: ${cause}. Recall still works by tokenizing; reinstall omo to restore the faster first recall.`, { cause: error })
    })
    return pending
  }
}

export const loadRecallStoreRuntime = createRecallStoreRuntimeLoader(() => import("#omo-recall-store-runtime"))
