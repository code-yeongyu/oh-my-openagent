// Sidecar entry for the persisted recall terms and compiled memory blocks, bundled as extensions/omo-recall-store.js and imported through
// `#omo-recall-store-runtime` on the first corpus load (see ./recall-store-runtime-loader.ts). The opt-in cross-language rerank
// (memory.recall.crosslingual) ships here too and loads only when that switch is on (see ./recall-crosslingual-loader.ts).

export { CompiledBlockStore, RecallTermPersistence } from "@oh-my-opencode/memory-core/recall-store"
export { createCrosslingualReranker } from "./recall-crosslingual"
