import { open, readFile, stat, unlink, writeHandleAll } from "../fs/resilient"

import { getPidLiveness, getProcessStartIdentity } from "../locks"

export type JournalLock = <T>(
  lockPath: string,
  task: () => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>

/**
 * Thrown when acquiring a transcript journal lock takes longer than the acquisition wait.
 * Replaces the raw EEXIST that used to escape through the extension event surface: callers
 * that treat journal writes as best-effort (the agent_settled reconcile) catch this and
 * degrade to a no-op so a contended lock never surfaces as an extension error.
 */
export class JournalLockTimeoutError extends Error {
  readonly retriable = true

  constructor(readonly lockPath: string) {
    super(`Timed out acquiring transcript journal lock: ${lockPath}`)
    this.name = "JournalLockTimeoutError"
  }
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds)
    const onAbort = (): void =>
      finish(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
    signal?.addEventListener("abort", onAbort, { once: true })
    function finish(error?: unknown): void {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (error === undefined) resolve()
      else reject(error)
    }
  })
}

const ACQUISITION_WAIT_MS = 5_000
const RETRY_DELAY_MS = 10

type OwnerPayload = { readonly pid: number; readonly startIdentity: string }

function parseOwner(raw: string): OwnerPayload | null {
  const [pidText, startIdentity] = raw.trimEnd().split("\n")
  const pid = Number.parseInt(pidText ?? "", 10)
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  return { pid, startIdentity: startIdentity ?? "" }
}

async function isOwnerDead(owner: OwnerPayload): Promise<boolean> {
  if (getPidLiveness(owner.pid) === "dead") return true
  if (owner.startIdentity.length === 0) return false
  const actual = await getProcessStartIdentity(owner.pid)
  // A live pid whose recorded start identity differs is a recycled pid wedging the lock.
  // When the platform offers no start identity (win32) the owner is left alone.
  return actual !== null && actual !== owner.startIdentity
}

/**
 * Best-effort reclaim of a lock whose owner is provably gone. A dead pid (ESRCH) or a live
 * pid whose recorded start identity no longer matches (pid reuse) is reclaimed; a payload-free
 * file older than the acquisition wait is reclaimed as an artifact of a creator that died
 * between open and write. The payload is re-read immediately before unlinking so a contender
 * that already recovered the lock is never stolen, and a live or unverifiable owner is always
 * left alone.
 */
async function tryReclaimStaleLock(lockPath: string): Promise<void> {
  const readRaw = (): Promise<string | null> =>
    readFile(lockPath, "utf8").catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null
      throw error
    })
  const snapshot = await readRaw()
  if (snapshot === null) return
  const owner = parseOwner(snapshot)
  if (owner !== null) {
    if (!(await isOwnerDead(owner))) return
  } else {
    const stats = await stat(lockPath).catch((error: unknown) => {
      if (errorCode(error) === "ENOENT") return null
      throw error
    })
    if (stats === null || Date.now() - stats.mtimeMs <= ACQUISITION_WAIT_MS) return
  }
  if ((await readRaw()) !== snapshot) return
  await unlink(lockPath).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error
  })
}

async function acquireAndRun<T>(
  lockPath: string,
  task: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  // The acquisition wait is measured from when THIS contender actually gets its turn, so a
  // same-process holder that ran before us on the queue never eats our cross-process budget.
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
      if (errorCode(error) !== "EEXIST" || Date.now() >= deadline) {
        throw new JournalLockTimeoutError(lockPath)
      }
      signal?.throwIfAborted()
      await tryReclaimStaleLock(lockPath)
      await delay(RETRY_DELAY_MS, signal)
    }
  }

  // The lock is held: the finally below is exempt cleanup and always runs, abort or not.
  try {
    const startIdentity = (await getProcessStartIdentity(process.pid)) ?? ""
    await writeHandleAll(handle, `${process.pid}\n${startIdentity}\n`, "utf8")
    signal?.throwIfAborted()
    return await task()
  } finally {
    await handle.close()
    await unlink(lockPath).catch((error: unknown) => {
      if (errorCode(error) !== "ENOENT") throw error
    })
  }
}

/** Per-lockPath FIFO that serializes acquisitions from THIS process so overlapping journal work never fights itself for the file; cross-process contention stays arbitrated by the file lock bounded by the acquisition wait. */
const queueTails = new Map<string, Promise<void>>()

export const withLocalJournalLock: JournalLock = (lockPath, task, signal) => {
  const previous = queueTails.get(lockPath) ?? Promise.resolve()
  const run = previous
    .catch(() => undefined)
    .then(() => {
      signal?.throwIfAborted()
      return acquireAndRun(lockPath, task, signal)
    })
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  queueTails.set(lockPath, tail)
  void tail.then(() => {
    if (queueTails.get(lockPath) === tail) queueTails.delete(lockPath)
  })
  return run
}
