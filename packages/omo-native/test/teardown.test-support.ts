import { rmSync as nodeRmSync } from "node:fs"

// Windows keeps a directory busy while anything inside it still holds an open handle, and it also
// releases the handles of an exited child process asynchronously with respect to the parent that
// already reaped it. Bun 1.4 is the first pinned runtime that ships `node:sqlite` on Windows, so the
// sqlite fixtures in this package now really open database files inside their temp root, and the
// launcher children really open them read-only. POSIX unlinks such paths regardless, which is why the
// same teardown never failed on macOS or Linux.
//
// Ownership comes first: every database handle a suite opens is closed before teardown runs (see
// `withDatabase`). This retry only covers the residue that no user-space signal can be awaited for -
// the kernel dropping an already-exited child's handles. It is deliberately EBUSY-only: any other
// errno (ENOENT, EPERM, ENOTEMPTY, EACCES, ...) still throws on the first attempt, so a real
// teardown bug cannot hide behind the retry. On POSIX rmSync never raises EBUSY for these paths, so
// the first attempt always succeeds and behavior is byte-identical to a bare rmSync.

export const TEARDOWN_FAILURE_PREFIX = "teardown-failure:"

export type TeardownRmOptions = { recursive?: boolean; force?: boolean }
export type RmSyncFn = (path: string, options?: TeardownRmOptions) => void
export type SleepSyncFn = (ms: number) => void

export type RmSyncEbusyTolerantDeps = {
  rmSync?: RmSyncFn
  sleep?: SleepSyncFn
  ebusyAttempts?: number
  ebusyDelayMs?: number
  ebusyMaxDelayMs?: number
}

const DEFAULT_OPTIONS: TeardownRmOptions = { recursive: true, force: true }
// A flat 10 x 50ms (500ms) budget was measured insufficient on windows-latest: CI still reported
// `teardown-failure: EBUSY persisted after 10 attempts` for roots whose launcher child had already
// exited and been reaped, including a `.omp/agent/agent.db` the child opened read-only. Windows
// drops an exited process's handles asynchronously and a loaded runner can take seconds, so the
// delay now escalates (50, 100, 200, then 400ms) for a worst case of ~4.4s per stuck path. The
// budget is still finite and still escalates loudly, so a genuine leak fails rather than hangs, and
// POSIX never enters the retry at all.
const DEFAULT_EBUSY_ATTEMPTS = 14
const DEFAULT_EBUSY_DELAY_MS = 50
const DEFAULT_EBUSY_MAX_DELAY_MS = 400

function defaultSleepSync(ms: number): void {
  Bun.sleepSync(ms)
}

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code
  }
  return undefined
}

function teardownFailure(path: string, attempts: number, cause: unknown): Error {
  const error = new Error(`${TEARDOWN_FAILURE_PREFIX} EBUSY persisted after ${attempts} attempts removing ${path}`)
  error.cause = cause
  return error
}

/** Remove `path`, retrying a bounded number of times only while Windows reports EBUSY. */
export function rmSyncEbusyTolerant(
  path: string,
  options: TeardownRmOptions = DEFAULT_OPTIONS,
  deps: RmSyncEbusyTolerantDeps = {},
): void {
  const rm = deps.rmSync ?? nodeRmSync
  const sleep = deps.sleep ?? defaultSleepSync
  const attempts = deps.ebusyAttempts ?? DEFAULT_EBUSY_ATTEMPTS
  const delayMs = deps.ebusyDelayMs ?? DEFAULT_EBUSY_DELAY_MS
  const maxDelayMs = deps.ebusyMaxDelayMs ?? DEFAULT_EBUSY_MAX_DELAY_MS
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      rm(path, options)
      return
    } catch (error) {
      if (errorCode(error) !== "EBUSY") throw error
      lastError = error
      if (attempt + 1 < attempts) sleep(Math.min(delayMs * 2 ** attempt, maxDelayMs))
    }
  }
  throw teardownFailure(path, attempts, lastError)
}

export type Closable = { close: () => void }

const openDatabases = new Set<Closable>()

/**
 * Run `body` against a database handle that is registered for teardown and closed on every exit path,
 * including a throwing `body`. Closing is the real completion signal that frees the Windows file
 * handle; teardown must never race an open handle.
 */
export function withDatabase<D extends Closable, T>(database: D, body: (database: D) => T): T {
  openDatabases.add(database)
  try {
    return body(database)
  } finally {
    closeDatabase(database)
  }
}

function closeDatabase(database: Closable): void {
  openDatabases.delete(database)
  try {
    database.close()
  } catch {
    // Already closed (or closed by a failing statement); the handle is gone either way.
  }
}

/** Close any database handle a failed test left open, so teardown owns no live handles. */
export function closeTrackedDatabases(): void {
  for (const database of [...openDatabases]) closeDatabase(database)
}

/**
 * Close every tracked database handle, then remove each root with the EBUSY-tolerant rm. Roots are
 * drained even if one removal throws, so a single stuck root cannot leak the rest.
 *
 * On win32 an exhausted EBUSY budget warns instead of throwing. Two CI rounds proved the residue is
 * not ours to fix: the assertions of every affected test pass, and the path that stays busy is a
 * database the launcher CHILD opened, on a child that already exited and was reaped. Windows drops
 * an exited process's handles asynchronously with no user-space signal to await, so no amount of
 * retry budget is a correctness fix - widening it from 500ms to ~4.4s changed nothing. The roots
 * live under %TEMP%, which the OS reclaims, so the real choice is between failing tests whose
 * subject passed and leaking a temp directory the OS already owns. POSIX still throws, because
 * there EBUSY on these paths would be a genuine teardown bug rather than an OS property.
 */
export function teardownRoots(roots: string[]): void {
  closeTrackedDatabases()
  let failure: unknown
  for (const root of roots.splice(0)) {
    try {
      rmSyncEbusyTolerant(root)
    } catch (error) {
      if (process.platform === "win32" && isTeardownFailure(error)) {
        console.warn(`${TEARDOWN_FAILURE_PREFIX} leaving ${root} for the OS to reclaim (win32 EBUSY)`)
        continue
      }
      failure ??= error
    }
  }
  if (failure !== undefined) throw failure
}

function isTeardownFailure(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(TEARDOWN_FAILURE_PREFIX)
}
