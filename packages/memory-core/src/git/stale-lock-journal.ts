import { join } from "node:path"

import { appendFile, unlink } from "../fs/resilient"
import type { GitLockSweepReport, KeptGitLock, KeptGitLockReason } from "./repo-lock-sweep"

/** One line per stale index.lock the writer removed without an owner record (#13808), next to the identity's locks. */
export const STALE_LOCK_JOURNAL = "stale-index-lock-removals.jsonl"

// The journal line is written before the unlink, so a removal is never left unrecorded.
export async function removeJournaled(
  indexLock: string,
  locksDir: string,
  facts: {
    readonly ageMs: number
    readonly before: { readonly mtimeMs: number; readonly size: number }
    readonly settleMs: number
  },
  keep: (reason: KeptGitLockReason) => GitLockSweepReport,
  kept: KeptGitLock[],
): Promise<GitLockSweepReport> {
  const { ageMs, before } = facts
  const journal = join(locksDir, STALE_LOCK_JOURNAL)
  const entry = {
    outcome: "removing",
    at: new Date().toISOString(),
    path: indexLock,
    ageMs,
    mtime: new Date(before.mtimeMs).toISOString(),
    size: before.size,
    checks: { repoUsers: 0, openHolders: 0, unchangedForMs: facts.settleMs },
  }
  await appendFile(journal, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  try {
    await unlink(indexLock)
  } catch {
    // The intent line stays; this one says the lock was kept, so status counts only real removals.
    await appendFile(
      journal,
      `${JSON.stringify({ outcome: "unlink-failed", at: new Date().toISOString(), path: indexLock })}\n`,
      { mode: 0o600 },
    ).catch(() => undefined)
    return keep("unlink-failed")
  }
  // Only this line counts as a removal, so a crash or a failed append between the two never overstates it.
  // The lock is already gone; a failed record must not fail the memory save that triggered the sweep.
  await appendFile(journal, `${JSON.stringify({ ...entry, outcome: "removed", at: new Date().toISOString() })}\n`, {
    mode: 0o600,
  }).catch(() => undefined)
  return { removed: [indexLock], kept }
}
