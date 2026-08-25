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
}

export interface GitTreeSizedEntry {
  readonly path: string
  readonly bytes: number
}
