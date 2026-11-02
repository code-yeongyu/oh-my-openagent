// Sidecar entry for the persisted recall terms and compiled memory blocks, bundled as extensions/omo-recall-store.js and imported through
// `#omo-recall-store-runtime` on the first corpus load (see ./recall-store-runtime-loader.ts).

export { CompiledBlockStore, RecallTermPersistence } from "@oh-my-opencode/memory-core/recall-store"
// memory-core's `#memory-external-projection` (the <external_projection> renderer) maps here in the plugin manifest,
// so the compiled-block path loads one sidecar for both.
export { renderExternalProjection, renderExternalProjectionStats } from "@oh-my-opencode/memory-core/external-projection"
// memory-core's `#memory-reflection-merge` (a reflection's merge into the memory repo and its stranded-merge repair) maps
// here too, keeping that git path out of the entry bundle.
export { healStrandedMerge, mergeValidatedTip } from "@oh-my-opencode/memory-core/reflection-merge"
