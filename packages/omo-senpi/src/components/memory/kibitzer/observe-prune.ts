// Sidecar retention lives in memory-core (retention/sidecars.ts) so the maintenance pass can run it
// across sessions; the kibitzer keeps calling it through this module.
export {
  KIBITZER_SIDECAR_RETENTION_MS,
  pruneKibitzerSidecars,
  type PruneKibitzerSidecarsOptions,
  type PruneKibitzerSidecarsResult,
} from "@oh-my-opencode/memory-core"
