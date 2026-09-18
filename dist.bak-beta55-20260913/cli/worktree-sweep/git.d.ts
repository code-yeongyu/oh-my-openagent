export interface GitResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}
export declare function runGit(cwd: string, args: readonly string[]): Promise<GitResult>;
export declare function listWorktreesPorcelain(repo: string): Promise<string>;
/**
 * Default branch detection: `origin/HEAD` symbolic ref first, then a local
 * `main`, then `master`. Mirrors the prototype's fallback chain.
 */
export declare function detectDefaultBranch(repo: string): Promise<string | undefined>;
/** `git merge-base --is-ancestor <ref> <default>` — the merged oracle. */
export declare function isMerged(repo: string, ref: string, defaultBranch: string): Promise<boolean>;
export declare function isDirty(worktreePath: string): Promise<boolean>;
/** Never uses `--force`: git itself refuses dirty and locked worktrees. */
export declare function removeWorktree(repo: string, worktreePath: string): Promise<GitResult>;
export declare function pruneWorktrees(repo: string): Promise<GitResult>;
export declare function resolveRepoRoot(cwd: string): Promise<string | undefined>;
