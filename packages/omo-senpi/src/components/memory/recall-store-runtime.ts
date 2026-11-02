// Sidecar entry for the persisted recall terms and compiled memory blocks, bundled as extensions/omo-recall-store.js and imported through
// `#omo-recall-store-runtime` on the first corpus load (see ./recall-store-runtime-loader.ts).

export { CompiledBlockStore, RecallTermPersistence } from "@oh-my-opencode/memory-core/recall-store"
// memory-core's `#memory-external-projection` (the <external_projection> renderer) maps here in the plugin manifest,
// so the compiled-block path loads one sidecar for both.
export { renderExternalProjection, renderExternalProjectionStats } from "@oh-my-opencode/memory-core/external-projection"
// memory-core's `#memory-host-identity` (the reflection lock's machine-id reader and hashed host rule) maps here too,
// keeping the platform machine-id lookup out of the entry bundle.
export { classifyHostIdentity, readCurrentMachineHash } from "@oh-my-opencode/memory-core/host-identity"
