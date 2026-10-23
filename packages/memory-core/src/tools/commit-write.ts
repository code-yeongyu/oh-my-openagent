import { readFile } from "../fs/resilient"
import { join } from "node:path"

import { refuseAgreementsViolation } from "./agreements-write-guard"
import { NoEffectiveChangesError, MemorySecretError, type GitCommitAuthor, type GitMemoryRepo } from "../git"
import { StrandedGitLockError } from "../git/repo-lock-sweep"
import { SOUL_EDIT_RESULT_LINE, touchesSoulPath } from "../soul"
import type { LockDomain } from "../locks"
import { claimReceiptTrailers } from "../provenance"
import type { MemoryToolProvenance } from "./memory"
import { provenanceStrippedTrailers } from "./claim-frontmatter"
import { undoBehindKeptLock } from "./rollback-behind-lock"
import { MemoryToolError } from "./tool-errors"

export interface CommitMemoryWriteOptions {
  readonly repo: GitMemoryRepo
  readonly lock: MemoryWriteLock
  readonly apply: () => Promise<AppliedWrite>
  readonly reason: string
  readonly author: GitCommitAuthor
  readonly provenance?: MemoryToolProvenance
  readonly successLabel: string
  readonly noChangesMessage?: string
  readonly writer?: "memory-tool" | "human-command"
}

// The paths a write touched, and the ones whose legacy user header it dropped (reported by the writer itself).
export interface AppliedWrite {
  readonly affectedPaths: readonly string[]
  readonly strippedPaths?: readonly string[]
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
  const writer = options.writer ?? "memory-tool"
  return lock("memory-write", async () => {
    await repo.cleanCheck()
    const applied = await options.apply()
    const paths = applied.affectedPaths
    if (paths.length === 0) throw new MemoryToolError(noChangesMessage ?? "made no changes")
    const violation = writer === "memory-tool" ? await refuseAgreementsViolation(repo, paths) : undefined
    if (violation !== undefined) throw new MemoryToolError(violation)
    let result
    try {
      result = await repo.commitWrite(paths, memoryCommitMessage(reason, provenance, writer, provenanceStrippedTrailers(applied.strippedPaths ?? [])), author)
    } catch (error) {
      if (error instanceof NoEffectiveChangesError) {
        throw new MemoryToolError(noChangesMessage ?? "made no effective changes", { cause: error })
      }
      if (error instanceof MemorySecretError) {
        await repo.restorePaths(paths)
        throw new MemoryToolError(error.message, { cause: error })
      }
      if (error instanceof StrandedGitLockError) return undoBehindKeptLock(repo, paths, error)
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

function memoryCommitMessage(
  reason: string,
  provenance: MemoryToolProvenance | undefined,
  writer: "memory-tool" | "human-command",
  stripped: readonly string[],
): string {
  if (provenance === undefined) return stripped.length === 0 ? reason : [reason, "", ...stripped].join("\n")
  return [
    reason,
    "",
    `Omo-Writer: ${writer}`,
    `Omo-Session: ${provenance.sessionId}`,
    `Omo-Turn: ${provenance.userTurns}`,
    ...(provenance.claim === undefined ? [] : claimReceiptTrailers(provenance.claim)),
    ...stripped,
  ].join("\n")
}
