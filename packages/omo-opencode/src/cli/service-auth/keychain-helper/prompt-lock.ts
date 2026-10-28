import { mkdir } from "node:fs/promises"
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
/**
 * Test seams: `beforePublish` runs between this caller's reservation and its publish (holding one copy there makes a race
 * deterministic); `removeRecord` replaces the release's unlink, so a test can observe what holds while it runs.
 */
export type PromptLockHooks = {
  readonly beforePublish?: () => Promise<void>
  readonly removeRecord?: (path: string, record: string) => Promise<unknown>
}

export function promptLockAt(path: string, hooks: PromptLockHooks = {}): () => Promise<(() => Promise<void>) | null> {
  return async () => {
    // Every bundled copy in this process shares this set. Checking and reserving it with no await in between means two
    // copies can never both proceed. A record on disk carrying this pid that is NOT in the set is therefore no live
    // holder here (a recycled pid's leftover, or a release whose unlink failed), and the reaper removes it as stale.
    const held = keychainProcessState().heldPromptLocks
    if (held.has(path)) return null
    held.add(path)
    let granted = false
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await hooks.beforePublish?.()
      for (let attempt = 0; attempt < 2; attempt++) {
        const record = buildLockRecord("keychain-prompt")
        if (await publishLockRecord(path, record)) {
          granted = true
          return async () => {
            markLockRecordReleased(record)
            try {
              await (hooks.removeRecord ?? ((target, owned) => removeLockRecordIfUnchanged(target, owned, Number.POSITIVE_INFINITY)))(
                path,
                record,
              )
            } finally {
              held.delete(path)
            }
          }
        }
        if ((await reapStaleLock(path, Number.POSITIVE_INFINITY)) !== "removed") return null
      }
      return null
    } finally {
      if (!granted) held.delete(path)
    }
  }
}
