import { open, rm } from "node:fs/promises"
import {
  buildLockRecord,
  forgetLockRecord,
  isLockRecordStale,
  markLockRecordHeld,
  markLockRecordReleased,
  readLockRecord,
  type ObservedLockRecord,
} from "../team-core/src/team-state-store/lock-record"
import { withRecordGuard } from "../team-core/src/team-state-store/lock-reclaim"

export const BINARY_UPDATE_TIMEOUT_MS = 15 * 60_000

function expired(record: ObservedLockRecord): boolean {
  const startedAt = Number(record.content.split("\n")[2])
  return Date.now() - (startedAt > 0 ? startedAt : record.modifiedAtEpochMs) >= BINARY_UPDATE_TIMEOUT_MS
}

/** The shared record includes PID, acquisition time, incarnation and OS process-start identity. */
export async function acquireBinaryUpdateLock(lockPath: string) {
  const record = await buildLockRecord("omo-binary-update")
  const guard = async <T>(expected: string, action: () => Promise<T>) => {
    const attempt = () => withRecordGuard(lockPath, expected, BINARY_UPDATE_TIMEOUT_MS, {}, action)
    const result = await attempt()
    // The shared primitive removes a crashed guard before yielding "busy". Finish that
    // recovery in this invocation; an active guard is still refused, not waited out.
    return result === "busy" ? await attempt() : result
  }
  const publish = async () => {
    let file
    try {
      file = await open(lockPath, "wx", 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false
      throw error
    }
    let complete = false
    try {
      await file.writeFile(record)
      await file.close()
      complete = true
      markLockRecordHeld(record)
      return true
    } finally {
      if (!complete) {
        try {
          await file.close()
        } finally {
          await rm(lockPath, { force: true })
        }
      }
    }
  }
  const stale = async (value: ObservedLockRecord) =>
    expired(value) || (await isLockRecordStale(value, BINARY_UPDATE_TIMEOUT_MS))
  if (!(await publish())) {
    const observed = await readLockRecord(lockPath)
    if (observed === null || !(await stale(observed))) return
    // Reapers and releasers of one record share this guard. Re-read inside it: a fresh
    // successor must never be removed on the strength of an earlier stale observation.
    const acquired = await guard(observed.content, async () => {
      const current = await readLockRecord(lockPath)
      if (current === null || current.content !== observed.content || !(await stale(current))) return false
      await rm(lockPath)
      return await publish()
    })
    if (acquired !== true) return
  }
  return {
    async run(install: () => Promise<void>): Promise<boolean> {
      const ran = await guard(record, async () => {
        const current = await readLockRecord(lockPath)
        if (current === null || current.content !== record || expired(current)) return false
        // Fence the swap, installed probe and rollback against reclamation. Downloads remain
        // outside this guard, so an expired downloader can be replaced without losing exclusion.
        await install()
        return true
      })
      return ran === true
    },
    async release(): Promise<void> {
      try {
        await guard(record, async () => {
          if ((await readLockRecord(lockPath))?.content === record) await rm(lockPath)
        })
      } finally {
        markLockRecordReleased(record)
        forgetLockRecord(record)
      }
    },
  }
}
