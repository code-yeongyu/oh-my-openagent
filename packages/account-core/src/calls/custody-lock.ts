import { open, stat, unlink } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"

// The custody log's own lock (security design 8.2, review 6065710236 N1, N4): every append and the recovery step take
// it, so a prune never drops a record appended while it ran and two recoveries never close one operation twice. It is a
// file created exclusively beside the log; one left by a process that died holding it is broken after STALE_MS. A call
// never waits on it long: past WAIT_MS the record is reported unwritten, the call's audit_unavailable note.

const WAIT_MS = 2000
const STALE_MS = 10_000
const RETRY_MS = 5

export async function withCustodyLock<T>(logPath: string, action: () => Promise<T>): Promise<T | undefined> {
  const lockPath = `${logPath}.lock`
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600)
      await handle.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const held = await stat(lockPath).catch(() => undefined)
      if (held !== undefined && Date.now() - held.mtimeMs > STALE_MS) await unlink(lockPath).catch(() => undefined)
      else if (Date.now() > deadline) return undefined
      else await delay(RETRY_MS)
    }
  }
  try {
    return await action()
  } finally {
    await unlink(lockPath).catch(() => undefined)
  }
}
