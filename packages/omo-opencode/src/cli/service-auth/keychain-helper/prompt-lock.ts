import { mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import { publishLockRecord } from "@oh-my-opencode/team-core/team-state-store/lock-publish"
import { buildLockRecord, markLockRecordReleased } from "@oh-my-opencode/team-core/team-state-store/lock-record"
import { reapStaleLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { removeLockRecordIfUnchanged } from "@oh-my-opencode/team-core/team-state-store/lock-reclaim"
import { keychainProcessState } from "./process-state"

/**
 * R4 (design 3.6): the machine-wide prompt lock around `approve`, taken with zero wait. Null means another process is
 * already showing the one dialog, so this caller must not open a second. A pending `approve` keeps holding it; a holder
 * that died leaves a record that is stale at once and is reaped by the next taker.
 */
export function promptLockAt(path: string): () => Promise<(() => Promise<void>) | null> {
  return async () => {
    // Every bundled copy in this process shares this set. Checking and reserving it with no await in between means two
    // copies can never both proceed, and a copy never reaps a record another copy of this process published (it carries
    // this pid with a different instance id, which the cross-process reaper would read as stale).
    const held = keychainProcessState().heldPromptLocks
    if (held.has(path)) return null
    held.add(path)
    let granted = false
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      for (let attempt = 0; attempt < 2; attempt++) {
        const record = buildLockRecord("keychain-prompt")
        if (await publishLockRecord(path, record)) {
          granted = true
          return async () => {
            markLockRecordReleased(record)
            held.delete(path)
            await removeLockRecordIfUnchanged(path, record, Number.POSITIVE_INFINITY)
          }
        }
        if (await heldByThisProcess(path)) return null
        if ((await reapStaleLock(path, Number.POSITIVE_INFINITY)) !== "removed") return null
      }
      return null
    } finally {
      if (!granted) held.delete(path)
    }
  }
}

async function heldByThisProcess(path: string): Promise<boolean> {
  const text = await readFile(path, "utf8").catch(() => null)
  return text?.split("\n")[1] === String(process.pid)
}
