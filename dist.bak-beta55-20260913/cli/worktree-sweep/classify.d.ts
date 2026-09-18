import type { ClassificationInput, WorktreeClassification, WorktreeRecord } from "./types";
/**
 * Externally-owned worktree roots. These are managed by other applications, so
 * sweeping them would delete state we do not own.
 */
export declare const DEFAULT_EXCLUDE_PREFIXES: readonly string[];
export declare function expandHome(value: string, home: string): string;
export declare function isExcludedPath(worktreePath: string, prefixes: readonly string[], home: string): boolean;
/** Branch name when attached, otherwise the detached HEAD sha. */
export declare function worktreeRef(record: WorktreeRecord): string;
/**
 * Single source of truth for sweep decisions. Mirrors the validated `git-wt-cl`
 * prototype: protection wins over eligibility, and eligibility requires both a
 * merged (or aged-out) ref and a clean tree.
 */
export declare function classifyWorktree(input: ClassificationInput): WorktreeClassification;
