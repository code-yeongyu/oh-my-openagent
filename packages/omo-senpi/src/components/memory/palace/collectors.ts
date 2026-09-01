// Compatibility exports for the established palace collector module.

export {
  UNCOMMITTED_LABEL,
  collectCore,
  collectExternal,
} from "./entry-collector"
export type {
  PalaceCoreEntry,
  PalaceEntryState,
  PalaceExternalEntry,
} from "./entry-collector"
export {
  HISTORY_MAX_COMMITS,
  HISTORY_PER_DIFF_CAP,
  HISTORY_RECENT_DIFFS,
  HISTORY_TOTAL_PAYLOAD_CAP,
  REFLECTION_COMMIT_PATTERN,
  collectHistory,
} from "./history-collector"
export type {
  PalaceCommit,
  PalaceHistory,
  PalaceHistoryCaps,
} from "./history-collector"
export { collectReflection } from "./reflection-collector"
export type {
  PalaceReflection,
  PalaceReflectionOutcome,
} from "./reflection-collector"
