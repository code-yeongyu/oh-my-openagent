import type { WorktreeClassification, WorktreeSweepResult } from "./types";
/**
 * One machine-parseable line per worktree:
 *   `SWEEP <path> <ref>` / `KEEP(<reason>) <path> <ref>` / `PRUNE <path> <ref>`
 */
export declare function formatClassification(classification: WorktreeClassification): string;
export declare function formatSummary(result: WorktreeSweepResult): string;
export declare function formatResult(result: WorktreeSweepResult): string[];
