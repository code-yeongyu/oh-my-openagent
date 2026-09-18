import type { WorktreeRecord } from "./types";
/**
 * Parses `git worktree list --porcelain` output. Records are separated by blank
 * lines; the first record is always the main worktree.
 */
export declare function parseWorktreeList(porcelain: string): WorktreeRecord[];
/** Drops the main worktree (first record), which is never a sweep candidate. */
export declare function linkedWorktrees(records: readonly WorktreeRecord[]): WorktreeRecord[];
