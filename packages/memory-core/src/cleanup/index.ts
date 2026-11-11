// Barrel exports only.
export { applyMemoryCleanup, type ApplyMemoryCleanupOptions, type MemoryCleanupApplyResult } from "./apply"
export type { CleanupCorpus, CleanupNote, NoteLink, SkippedFile } from "./corpus"
export { planMemoryCleanup } from "./plan"
export { renderMemoryCleanupReport, type RenderMemoryCleanupReportOptions } from "./report"
export {
  MEMORY_CLEANUP_CLASSES,
  type CleanupAction,
  type CleanupEvidence,
  type HeldFinding,
  type KeptNote,
  type MemoryCleanupBudget,
  type MemoryCleanupClass,
  type MemoryCleanupFinding,
  type MemoryCleanupOptions,
  type MemoryCleanupPlan,
  type MemoryCleanupSummary,
  type ResolvedCleanupOptions,
} from "./types"
