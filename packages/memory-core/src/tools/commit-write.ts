import { readFile } from "../fs/resilient"
import { join } from "node:path"

import { NoEffectiveChangesError, type GitCommitAuthor, type GitMemoryRepo } from "../git"
import { SOUL_EDIT_RESULT_LINE, touchesSoulPath } from "../soul"
import type { LockDomain } from "../locks"
import type { MemoryToolProvenance } from "./memory"
import { MemoryToolError } from "./tool-errors"

export interface CommitMemoryWriteOptions {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryWriteLock
  readonly apply: () => Promise<readonly string[]>
  readonly reason: string
  readonly author: GitCommitAuthor
  readonly provenance?: MemoryToolProvenance
  readonly successLabel: string
  readonly noChangesMessage?: string
}

export interface MemoryWriteLock {
  <T>(domain: LockDomain, operation: () => Promise<T>): Promise<T>
}

export interface MemoryWriteCommit {
  readonly message: string
  readonly sha: string
  readonly subject: string
  readonly affectedPaths: readonly string[]
}

export async function commitMemoryWrite(options: CommitMemoryWriteOptions): Promise<MemoryWriteCommit> {
  const { repo, lock, reason, author, provenance, successLabel, noChangesMessage } = options
  return lock("memory-write", async () => {
    await repo.cleanCheck()
    const paths = await options.apply()
    if (paths.length === 0) throw new MemoryToolError(noChangesMessage ?? "made no changes")
    let result
    try {
      result = await repo.commitWrite(paths, memoryCommitMessage(reason, provenance), author)
    } catch (error) {
      if (error instanceof NoEffectiveChangesError) {
        throw new MemoryToolError(noChangesMessage ?? "made no effective changes", { cause: error })
      }
      throw error
    }
    const shortSha = result.sha.slice(0, 7)
    const local = !(await hasConfiguredRemote(repo))
    const summary = local
      ? `${successLabel} committed locally (${shortSha}).`
      : `${successLabel} committed (${shortSha}); harness will sync after the turn.`
    return {
      message: touchesSoulPath(paths) ? `${summary}\n${SOUL_EDIT_RESULT_LINE}` : summary,
      sha: result.sha,
      subject: reason.split(/\r?\n/, 1)[0] ?? reason,
      affectedPaths: paths,
    }
  })
}

async function hasConfiguredRemote(repo: GitMemoryRepo): Promise<boolean> {
  const gitConfig = await readFile(join(repo.dir, ".git", "config"), "utf8").catch(() => "")
  return /^\s*\[remote\s+"[^"]+"\]/m.test(gitConfig)
}

function memoryCommitMessage(reason: string, provenance: MemoryToolProvenance | undefined): string {
  if (provenance === undefined) return reason
  return [
    reason,
    "",
    "Omo-Writer: memory-tool",
    `Omo-Session: ${provenance.sessionId}`,
    `Omo-Turn: ${provenance.userTurns}`,
  ].join("\n")
}
