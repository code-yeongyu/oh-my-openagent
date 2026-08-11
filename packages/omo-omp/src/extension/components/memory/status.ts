import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"

export const MEMORY_STATUS_KEY = "memory"
const SECOND_MS = 1_000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export interface MemoryStatusUi {
  setStatus(key: string, text: string | undefined): void
  notify(message: string, level: "error" | "warning"): void
}

export interface GitRepoForStatus {
  head(): Promise<string | null>
  headCommitTimestamp(): Promise<number | null>
  lsTree(revision?: string, path?: string): Promise<string[]>
  show(revision: string, path: string): Promise<string>
}

export interface MemoryStatusResult {
  readonly notified: boolean
  readonly footerShown: boolean
}

export interface RefreshMemoryStatusInput {
  readonly context: MemoryIdentityContext
  readonly ui: MemoryStatusUi
  readonly compileWarnTokens: number
  readonly alreadyNotified: boolean
  readonly gitRepo?: GitRepoForStatus
  readonly now?: () => number
  readonly showFooter?: boolean
  readonly checkAdvisory?: boolean
}

export async function refreshMemoryStatus(input: RefreshMemoryStatusInput): Promise<MemoryStatusResult> {
  const repo = input.gitRepo ?? createGitRepo(input.context.identityPaths.repo)
  const head = await repo.head()
  if (head === null) return { notified: false, footerShown: false }

  let footerShown = false
  if (input.showFooter !== false) {
    const committedAt = await repo.headCommitTimestamp()
    const age = committedAt === null
      ? null
      : formatRelativeAge(committedAt * SECOND_MS, (input.now ?? Date.now)())
    if (age !== null) {
      input.ui.setStatus(MEMORY_STATUS_KEY, `mem:${input.context.identity} ${age}`)
      footerShown = true
    }
  }

  if (input.checkAdvisory === false || input.alreadyNotified) return { notified: false, footerShown }

  const estimate = await estimateSystemTokens(repo, head)
  if (estimate < input.compileWarnTokens) return { notified: false, footerShown }

  input.ui.notify(
    `system memory ~${estimate} tokens exceeds advisory ${input.compileWarnTokens}; consider /doctor`,
    "warning",
  )
  return { notified: true, footerShown }
}

async function estimateSystemTokens(repo: GitRepoForStatus, head: string): Promise<number> {
  const paths = await repo.lsTree(head)
  const systemMarkdownPaths = paths.filter(isSystemMarkdown)
  if (systemMarkdownPaths.length === 0) return 0
  const contents = await Promise.all(
    systemMarkdownPaths.map((path) => repo.show(head, path)),
  )
  const totalBytes = contents.reduce((sum, content) => sum + Buffer.byteLength(content, "utf8"), 0)
  return Math.floor(totalBytes / 4)
}

function isSystemMarkdown(path: string): boolean {
  return path.startsWith("system/") && path.endsWith(".md")
}

function formatRelativeAge(committedAt: number, now: number): string | null {
  const age = now - committedAt
  if (!Number.isFinite(age) || age < 0) return null
  if (age < MINUTE_MS) return "just now"
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)}m ago`
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)}h ago`
  return `${Math.floor(age / DAY_MS)}d ago`
}

function createGitRepo(repoPath: string): GitRepoForStatus {
  const repo = new GitMemoryRepo({ dir: repoPath, agentId: "omo-status" })
  return {
    head: () => repo.head(),
    headCommitTimestamp: () => repo.headCommitTimestamp(),
    lsTree: (revision, path) => repo.lsTree(revision, path),
    show: (revision, path) => repo.show(revision, path),
  }
}
