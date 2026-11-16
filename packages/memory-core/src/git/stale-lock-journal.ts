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
  const entry = {
    at: new Date().toISOString(),
    path: indexLock,
    ageMs,
    mtime: new Date(before.mtimeMs).toISOString(),
    size: before.size,
    checks: { repoUsers: 0, openHolders: 0, unchangedForMs: facts.settleMs },
  }
  await appendFile(join(locksDir, STALE_LOCK_JOURNAL), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  try {
    await unlink(indexLock)
  } catch {
    return keep("unlink-failed")
  }
  return { removed: [indexLock], kept }
}
