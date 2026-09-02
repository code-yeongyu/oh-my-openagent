import path from "node:path"

import { readdir, stat, unlink } from "../fs/resilient"

export const CANDIDATE_STALE_AGE_MS = 60 * 60 * 1000
export const CANDIDATE_UNLINK_ATTEMPTS = 3

export interface CandidateSweepOptions {
  readonly unlink?: (path: string) => Promise<void>
  readonly isSharingError?: (error: unknown) => boolean
  readonly onFailure?: (path: string) => void
  readonly onNonSharingFailure?: (path: string) => void
}

// Lock DOMAIN names may legally contain ".candidate-" (runFinalizationLockPath permits dots
// and hyphens in run ids), so only the exact UUID-suffixed shape publishExclusive generates
// is ever treated as sweepable garbage.
const LEAKED_CANDIDATE_NAME =
  /\.candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

function notifyFailure(options: CandidateSweepOptions, candidatePath: string): void {
  try {
    options.onFailure?.(candidatePath)
  } catch {
    // Cleanup notifications are advisory and must not prevent later candidates from being swept.
  }
}

function notifyNonSharingFailure(options: CandidateSweepOptions, candidatePath: string): void {
  try {
    options.onNonSharingFailure?.(candidatePath)
  } catch {
    // Cleanup notifications are advisory and must not prevent later candidates from being swept.
  }
}

function isSharingError(error: unknown): boolean {
  if (process.platform !== "win32") return false
  const code = errorCode(error)
  return code === "EBUSY" || code === "EPERM" || code === "EACCES"
}

// Crashed contenders leak `<lock>.candidate-<uuid>` files: publishExclusive unlinks its
// candidate in a finally block, but SIGKILL mid-publish skips it. Nothing ever reads a
// candidate after publish, so age is the only liveness signal the sweeper needs; live lock
// and recovery files never contain ".candidate-" and are never touched.
export async function sweepStaleLockCandidates(
  lockDirectory: string,
  now: () => number = Date.now,
  options: CandidateSweepOptions = {},
): Promise<number> {
  let names: readonly string[]
  try {
    names = await readdir(lockDirectory)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0
    throw error
  }
  let swept = 0
  for (const name of names) {
    if (!LEAKED_CANDIDATE_NAME.test(name)) continue
    const candidatePath = path.join(lockDirectory, name)
    try {
      const status = await stat(candidatePath)
      if (now() - status.mtimeMs <= CANDIDATE_STALE_AGE_MS) continue
      let removed = false
      for (let attempt = 0; attempt < CANDIDATE_UNLINK_ATTEMPTS; attempt += 1) {
        try {
          await (options.unlink ?? unlink)(candidatePath)
          removed = true
          break
        } catch (error) {
          if (errorCode(error) === "ENOENT") {
            removed = true
            break
          }
          const sharing = options.isSharingError?.(error) ?? isSharingError(error)
          if (!sharing) throw error
          if (attempt + 1 === CANDIDATE_UNLINK_ATTEMPTS) notifyFailure(options, candidatePath)
        }
      }
      if (removed) swept += 1
    } catch (error) {
      // Sharing failures retain their scheduled age-window backoff. Other filesystem errors
      // rearm the outer acquisition before remaining candidates continue to be swept.
      const sharing = options.isSharingError?.(error) ?? isSharingError(error)
      if (!sharing) notifyNonSharingFailure(options, candidatePath)
      notifyFailure(options, candidatePath)
    }
  }
  return swept
}
