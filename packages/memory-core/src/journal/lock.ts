import { open, readFile, stat, unlink } from "node:fs/promises"

import { getPidLiveness } from "../locks"

export type JournalLock = <T>(
  lockPath: string,
  task: () => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const ACQUISITION_WAIT_MS = 5_000

/**
 * Best-effort reclaim of a lock whose owner provably no longer exists. The payload is the
 * owner's pid written in the same tick that creates the file: a signal-0 probe answering
 * ESRCH means the holder died while holding it, and a payload-free file older than the
 * acquisition wait means the creator died between open and write. The payload is re-read
 * immediately before unlinking so a contender that already recovered the lock is never
 * stolen, and a live or unverifiable owner is always left alone.
 */
async function tryReclaimStaleLock(lockPath: string): Promise<void> {
  const readOwner = () =>
    readFile(lockPath, "utf8").catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null
      throw error
    })
  const snapshot = await readOwner()
  if (snapshot === null) return
  const ownerPid = Number.parseInt(snapshot.trim(), 10)
  if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
    if (getPidLiveness(ownerPid) !== "dead") return
  } else {
    const stats = await stat(lockPath).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null
      throw error
    })
    if (stats === null || Date.now() - stats.mtimeMs <= ACQUISITION_WAIT_MS) return
  }
  if ((await readOwner()) !== snapshot) return
  await unlink(lockPath).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
}

export const withLocalJournalLock: JournalLock = async (lockPath, task, signal) => {
  const deadline = Date.now() + ACQUISITION_WAIT_MS
  let handle
  for (;;) {
    // Abort before acquisition leaves no lock file behind (IC-11), so a drain that already
    // returned never creates and deletes state.lock behind the caller's back.
    signal?.throwIfAborted()
    try {
      handle = await open(lockPath, "wx", 0o600)
      break
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || Date.now() >= deadline) throw error
      signal?.throwIfAborted()
      await tryReclaimStaleLock(lockPath)
      await delay(10)
    }
  }

  // The lock is held: the finally below is exempt cleanup and always runs, abort or not.
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8")
    signal?.throwIfAborted()
    return await task()
  } finally {
    await handle.close()
    await unlink(lockPath).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error
    })
  }
}
