import { rename, unlink, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { dirname } from "node:path"
import { log } from "../../shared/logger"
import { STATE_FILE_PATH, DEFAULT_UPSTREAM_REMOTE, DEFAULT_UPSTREAM_BRANCH } from "./constants"
import type { SyncForkState, CommitStatus, Priority } from "./types"

export function createDefaultState(): SyncForkState {
  return {
    version: 1,
    upstream: {
      remote: DEFAULT_UPSTREAM_REMOTE,
      branch: DEFAULT_UPSTREAM_BRANCH,
      lastFetchedAt: new Date().toISOString(),
    },
    lastReviewedCommit: null,
    lastReviewedAt: null,
    commits: {},
  }
}

export function readState(basePath: string = process.cwd()): SyncForkState | null {
  const fullPath = `${basePath}/${STATE_FILE_PATH}`
  if (!existsSync(fullPath)) {
    log(`[sync-fork] No state file found at ${fullPath}`)
    return null
  }

  try {
    const content = readFileSync(fullPath, "utf-8")
    const state = JSON.parse(content) as SyncForkState

    if (state.version !== 1) {
      log(`[sync-fork] State file version mismatch: expected 1, got ${state.version}`)
      return null
    }

    return state
  } catch (e) {
    log(`[sync-fork] Failed to read state file: ${e}`)
    return null
  }
}

export async function atomicWriteState(
  state: SyncForkState,
  basePath: string = process.cwd()
): Promise<void> {
  const fullPath = `${basePath}/${STATE_FILE_PATH}`
  const tempPath = `${fullPath}.tmp.${Date.now()}`
  const dir = dirname(fullPath)

  try {
    await mkdir(dir, { recursive: true })
    await Bun.write(tempPath, JSON.stringify(state, null, 2))
    await rename(tempPath, fullPath)
    log(`[sync-fork] State file written to ${fullPath}`)
  } catch (e) {
    try {
      await unlink(tempPath)
    } catch {
      // Ignore cleanup errors
    }
    throw e
  }
}

export async function deleteState(basePath: string = process.cwd()): Promise<boolean> {
  const fullPath = `${basePath}/${STATE_FILE_PATH}`
  if (!existsSync(fullPath)) {
    return false
  }

  try {
    await unlink(fullPath)
    log(`[sync-fork] State file deleted: ${fullPath}`)
    return true
  } catch (e) {
    log(`[sync-fork] Failed to delete state file: ${e}`)
    return false
  }
}

export function getOrCreateState(basePath: string = process.cwd()): SyncForkState {
  const existing = readState(basePath)
  if (existing) {
    return existing
  }
  return createDefaultState()
}

export function updateCommitStatus(
  state: SyncForkState,
  sha: string,
  status: CommitStatus["status"],
  opts?: {
    pr?: string
    reason?: string
    recommendation?: Priority | "Skip"
    linearIssue?: string
  }
): void {
  state.commits[sha] = {
    status,
    reviewedAt: new Date().toISOString(),
    ...opts,
  }
}

export function markCommitAsSynced(
  state: SyncForkState,
  sha: string,
  prNumber: string
): void {
  updateCommitStatus(state, sha, "synced", { pr: prNumber })
}

export function markCommitAsSkipped(
  state: SyncForkState,
  sha: string,
  reason: string
): void {
  updateCommitStatus(state, sha, "skipped", { reason })
}

export function markCommitAsReviewed(
  state: SyncForkState,
  sha: string,
  recommendation: Priority | "Skip"
): void {
  updateCommitStatus(state, sha, "reviewed", { recommendation })
}

export function updateLastReviewed(state: SyncForkState, sha: string): void {
  state.lastReviewedCommit = sha
  state.lastReviewedAt = new Date().toISOString()
}

export function isCommitInState(state: SyncForkState, sha: string): boolean {
  return sha in state.commits
}

export function getNewCommits(
  state: SyncForkState,
  allShas: string[]
): string[] {
  return allShas.filter((sha) => !isCommitInState(state, sha))
}
