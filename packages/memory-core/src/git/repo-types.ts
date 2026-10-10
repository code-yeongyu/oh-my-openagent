import type { GitExec } from "./exec"

export interface GitCommitAuthor {
  agentId: string
  authorName: string
  authorEmail?: string
}

export interface GitSeedFile {
  relativePath: string
  content: string
}

export interface GitMemoryRepoOptions {
  dir: string
  agentId: string
  exec?: GitExec
  installHooks?: (dir: string) => void | Promise<void>
}

export interface InitializeGitRepoOptions {
  authorName?: string
  seedFiles?: readonly GitSeedFile[]
  installHooks?: (dir: string) => void | Promise<void>
}

export interface GitCommitResult {
  committed: true
  sha: string
}

export interface GitMergeOptions {
  noFF?: boolean
  message?: string
}

export interface MemoryCommit {
  readonly sha: string
  readonly subject: string
  readonly body: string
  readonly authorName: string
  readonly authorEmail: string
  readonly committedAt: string
  readonly trailers: Readonly<Record<string, string>>
  readonly paths?: readonly string[]
}

export interface GitLogOptions {
  readonly range?: string
  readonly paths?: readonly string[]
  readonly limit?: number
  readonly includePaths?: boolean
  /**
   * Fixed strings every returned commit's message must contain (all of them, `--all-match`). Lets a
   * caller looking for one trailer combination have git filter the history instead of parsing every
   * commit into memory first.
   */
  readonly grep?: readonly string[]
  /**
   * Only commits newer than this. git stops walking once it reaches older commits, so a caller that
   * knows when its work began pays for the commits since then, not for the whole history.
   */
  readonly since?: Date
  /** Overrides the default 30 s git timeout, for a caller on a latency-sensitive path. */
  readonly timeoutMs?: number
}

export interface GitMaintenanceOptions {
  /** Run only when git reports at least this many loose objects. */
  readonly minLooseObjects: number
  /** Upper bound for the maintenance run itself. */
  readonly timeoutMs: number
  /** Stops the run (session exit). git is sent SIGTERM and removes its own temp files. */
  readonly signal?: AbortSignal
}

export type GitMaintenanceResult =
  | { readonly status: "skipped"; readonly looseObjects: number }
  | { readonly status: "packed"; readonly looseObjectsBefore: number; readonly looseObjectsAfter: number }

export interface GitTreeSizedEntry {
  readonly path: string
  readonly bytes: number
}

export interface GitTreeBlobEntry {
  readonly path: string
  readonly oid: string
}
