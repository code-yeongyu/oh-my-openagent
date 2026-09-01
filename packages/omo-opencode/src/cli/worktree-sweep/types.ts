export interface WorktreeRecord {
  /** Absolute worktree path as reported by `git worktree list --porcelain`. */
  readonly path: string
  /** Commit SHA of the worktree HEAD, when reported. */
  readonly head?: string
  /** Short branch name (`refs/heads/` stripped), when the worktree is attached. */
  readonly branch?: string
  readonly detached: boolean
  readonly locked: boolean
  /** Lock reason string recorded by `git worktree lock --reason`, when present. */
  readonly lockReason?: string
  readonly prunable: boolean
}

export type WorktreeDecision = "SWEEP" | "KEEP" | "PRUNE"

export type WorktreeKeepReason = "locked" | "external" | "unmerged" | "dirty"

export interface WorktreeClassification {
  readonly path: string
  /** Branch name when attached, otherwise the HEAD sha; empty when neither is known. */
  readonly ref: string
  readonly decision: WorktreeDecision
  readonly reason?: WorktreeKeepReason
}

export interface ClassificationInput {
  readonly record: WorktreeRecord
  /** False when the worktree path no longer exists on disk. */
  readonly pathExists: boolean
  readonly merged: boolean
  /** True when `--older-than` is satisfied; always false when `--older-than=0`. */
  readonly agedOut: boolean
  readonly dirty: boolean
  /** True when the path lives under one of the configured protected prefixes. */
  readonly external: boolean
}

export interface WorktreeSweepRepoReport {
  readonly repo: string
  readonly defaultBranch: string
  readonly classifications: readonly WorktreeClassification[]
  /** Paths actually removed; always empty in dry-run mode. */
  readonly removed: readonly string[]
  /** Paths that `git worktree remove` refused, with the git error text. */
  readonly failed: readonly { readonly path: string; readonly error: string }[]
}

export interface WorktreeSweepResult {
  readonly apply: boolean
  readonly olderThanDays: number
  readonly repos: readonly WorktreeSweepRepoReport[]
  readonly sweepCount: number
  readonly keepCount: number
  readonly pruneCount: number
}

export interface WorktreeSweepOptions {
  /** Dry-run is the default; only an explicit `true` removes anything. */
  readonly apply?: boolean
  /** 0 means merged-only: unmerged worktrees are never swept. */
  readonly olderThanDays?: number
  /** Repositories to sweep; defaults to the current working directory's repo. */
  readonly repos?: readonly string[]
  readonly json?: boolean
  /** Overrides the built-in externally-owned path prefixes. */
  readonly excludePrefixes?: readonly string[]
  readonly cwd?: string
}
