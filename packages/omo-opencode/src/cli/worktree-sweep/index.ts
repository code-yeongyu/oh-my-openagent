export { classifyWorktree, DEFAULT_EXCLUDE_PREFIXES, isExcludedPath } from "./classify"
export { formatClassification, formatResult, formatSummary } from "./format"
export { parseOlderThanDays } from "./options"
export { parseWorktreeList, linkedWorktrees } from "./parse-worktree-list"
export { sweepWorktrees } from "./sweep"
export { worktreeSweep } from "./worktree-sweep"
export type {
  ClassificationInput,
  WorktreeClassification,
  WorktreeDecision,
  WorktreeKeepReason,
  WorktreeRecord,
  WorktreeSweepOptions,
  WorktreeSweepRepoReport,
  WorktreeSweepResult,
} from "./types"
