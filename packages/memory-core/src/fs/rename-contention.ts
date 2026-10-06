import type { PathLike } from "node:fs"

import { fsErrorCode } from "./retry"

// Windows refuses a rename onto a file another handle holds open (a reader, the search indexer,
// an antivirus scan) with EPERM, EBUSY or EACCES, and the hold usually clears within milliseconds.
// Atomic memory writes rename a temporary file over their target, so a passing hold would lose the
// write. POSIX reports EPERM/EACCES only for real permission errors, so it fails at once there.
const CONTENTION_CODES = new Set(["EPERM", "EBUSY", "EACCES"])
const CONTENTION_DELAYS_MS: readonly number[] = [10, 25, 50, 100, 200, 400]

export type RenameContentionDeps = {
  readonly rename: (from: PathLike, to: PathLike) => Promise<void>
  readonly platform: NodeJS.Platform
  readonly delaysMs?: readonly number[]
  readonly sleep?: (ms: number) => Promise<void>
}

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function renameWithContentionRetry(from: PathLike, to: PathLike, deps: RenameContentionDeps): Promise<void> {
  const delays = deps.platform === "win32" ? (deps.delaysMs ?? CONTENTION_DELAYS_MS) : []
  const sleep = deps.sleep ?? sleepFor
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.rename(from, to)
      return
    } catch (error) {
      const delay = delays[attempt]
      const code = fsErrorCode(error)
      if (delay === undefined || code === undefined || !CONTENTION_CODES.has(code)) throw error
      await sleep(delay)
    }
  }
}
