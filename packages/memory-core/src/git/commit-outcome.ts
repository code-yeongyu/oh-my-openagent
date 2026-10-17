import { GitTimeoutError } from "./errors"
import type { GitExecResult } from "./exec"

// A `git commit` that timed out may still have committed: the commit object and the HEAD update
// can land before a slow hook or a loaded host pushes it past the budget (omo #10199 field
// incident: the write was reported failed although it was on HEAD). Commits are serialized under
// the memory-write lock, so a HEAD that moved exactly one commit, from the HEAD seen before this
// commit, with this write's subject, is this write's commit.
export interface CommitOutcomeReads {
  head(): Promise<string | null>
  result(argv: readonly string[]): Promise<GitExecResult>
}

async function landedAfterTimeout(reads: CommitOutcomeReads, headBefore: string | null, message: string): Promise<string | null> {
  const head = await reads.head()
  if (head === null || head === headBefore) return null
  const parent = await reads.result(["rev-parse", "--verify", "--quiet", `${head}^`])
  const parentSha = parent.code === 0 ? parent.stdout.trim() : null
  if (parentSha !== headBefore) return null
  const subject = await reads.result(["log", "-1", "--format=%s", head])
  return subject.code === 0 && subject.stdout.trim() === (message.split("\n")[0] ?? "").trim() ? head : null
}

// Runs one commit and returns the SHA it produced when the commit timed out but landed anyway;
// `undefined` means the commit returned normally. A timeout with nothing landed rethrows.
export async function commitJudgedByOutcome(commit: () => Promise<unknown>, reads: CommitOutcomeReads, message: string): Promise<string | undefined> {
  const headBefore = await reads.head()
  try {
    await commit()
    return undefined
  } catch (error) {
    if (!(error instanceof GitTimeoutError)) throw error
    const landed = await landedAfterTimeout(reads, headBefore, message)
    if (landed === null) throw error
    return landed
  }
}
