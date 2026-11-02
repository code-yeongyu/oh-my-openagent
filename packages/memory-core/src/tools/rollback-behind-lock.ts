import { join } from "node:path"

import { existsSync } from "../fs/resilient"
import type { GitMemoryRepo } from "../git"
import { recordPendingRollback } from "../git/pending-rollback"
import type { StrandedGitLockError } from "../git/repo-lock-sweep"
import { restoreWorktreeFromHead } from "../git/worktree-restore"
import { MemoryToolError } from "./tool-errors"

// A write that fails behind a kept git lock must not leave its change behind, or every later write
// hits "uncommitted changes" even after /memory unlock (omo #10199). Whether `git add` already
// staged it depends on WHEN the lock appeared, not on which lock it is, so the decision reads the
// index itself. A staged change cannot be unstaged while index.lock exists; it is recorded inside
// .git, and GitMemoryRepo unstages it (index only) at the next write once the lock is gone.

function indexLockHeld(repo: GitMemoryRepo): boolean {
  return existsSync(join(repo.dir, ".git", "index.lock"))
}

// Porcelain v1 "XY path": a non-blank, non-untracked X column is a staged change.
async function hasStagedChange(repo: GitMemoryRepo, paths: readonly string[]): Promise<boolean> {
  const lines = (await repo.status(paths)).split(/\r?\n/).filter((line) => line.length > 3)
  return lines.some((line) => line[0] !== " " && line[0] !== "?")
}

export async function undoBehindKeptLock(repo: GitMemoryRepo, paths: readonly string[], kept: StrandedGitLockError): Promise<never> {
  let stillStaged = false
  try {
    if (!(await hasStagedChange(repo, paths))) {
      await restoreWorktreeFromHead(repo, paths)
    } else if (!indexLockHeld(repo)) {
      await repo.restorePaths(paths)
    } else {
      await restoreWorktreeFromHead(repo, paths)
      const head = await repo.head()
      if (head === null) throw new Error("the memory repository has no HEAD commit")
      await recordPendingRollback(repo.dir, { head, paths })
      stillStaged = true
    }
  } catch (restoreError) {
    const reason = restoreError instanceof Error ? restoreError.message : String(restoreError)
    throw new MemoryToolError(
      `${kept.message}\nThe change this write made could not be undone (${reason}); before retrying, restore or remove: ${paths.join(", ")}`,
      { cause: new AggregateError([kept, restoreError]) },
    )
  }
  if (!stillStaged) throw kept
  throw new MemoryToolError(
    `${kept.message}\nThis write is still staged because the index itself is locked; it is unstaged automatically before the next memory write once that lock is removed.`,
    { cause: kept },
  )
}
