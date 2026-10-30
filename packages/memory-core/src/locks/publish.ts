import { randomUUID } from "node:crypto"
import { EINTR_RETRY_CAP, link, mkdir, open, unlink, writeHandleAll } from "../fs/resilient"
import type { FileHandle } from "../fs/resilient"
import path from "node:path"

import { CANDIDATE_UNLINK_ATTEMPTS, forgetLeakedCandidate, trackLeakedCandidate } from "./candidate-sweep"
import type { LockRecord } from "./lock-record"
import { rearmCandidateSweep } from "./sweep-memo"

const LINK_FALLBACK_ERRORS = new Set(["EACCES", "EPERM", "ENOTSUP"])

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

export function isUnlinkSharingError(error: unknown, override?: (error: unknown) => boolean): boolean {
  if (override !== undefined) return override(error)
  if (process.platform !== "win32") return false
  const code = errorCode(error)
  return code === "EBUSY" || code === "EPERM" || code === "EACCES"
}

export interface LockCandidateFs {
  readonly link?: typeof link
  readonly unlink?: (path: string) => Promise<void>
  readonly writeFallback?: typeof writeHandleAll
  readonly isSharingError?: (error: unknown) => boolean
}

let candidateFs: LockCandidateFs = {}

/** Test seam for deterministic Windows sharing-failure coverage; production uses resilient fs. */
export function setLockCandidateFsForTests(next: LockCandidateFs | undefined): () => void {
  const previous = candidateFs
  candidateFs = next ?? {}
  return () => { candidateFs = previous }
}

/** The candidate-filesystem overrides currently installed (empty in production). */
export function currentCandidateFs(): LockCandidateFs {
  return candidateFs
}

async function unlinkCandidate(candidatePath: string): Promise<boolean> {
  for (let attempt = 0; attempt < CANDIDATE_UNLINK_ATTEMPTS; attempt += 1) {
    try {
      await (candidateFs.unlink ?? unlink)(candidatePath)
      forgetLeakedCandidate(candidatePath)
      return true
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        forgetLeakedCandidate(candidatePath)
        return true
      }
      const sharing = isUnlinkSharingError(error, candidateFs.isSharingError)
      if (!sharing) {
        trackLeakedCandidate(candidatePath)
        rearmCandidateSweep(path.dirname(candidatePath))
        throw error
      }
      if (attempt + 1 === CANDIDATE_UNLINK_ATTEMPTS) {
        trackLeakedCandidate(candidatePath)
        rearmCandidateSweep(path.dirname(candidatePath))
        return false
      }
    }
  }
  return false
}

// Exclusive creates are ambiguous under EINTR (the candidate may exist afterwards), and the
// candidate name is a per-attempt UUID, so recovery is simply: discard that name and retry
// with a fresh one. Anything the interrupted open did create is unlinked best-effort.
async function openFreshCandidate(
  lockPath: string,
): Promise<{ readonly candidatePath: string; readonly handle: FileHandle }> {
  for (let attempt = 0; ; attempt += 1) {
    const candidatePath = `${lockPath}.candidate-${process.pid}-${randomUUID()}`
    try {
      return { candidatePath, handle: await open(candidatePath, "wx", 0o600) }
    } catch (error) {
      const removed = await unlinkCandidate(candidatePath)
      if (!removed) rearmCandidateSweep(path.dirname(lockPath))
      if (errorCode(error) !== "EINTR" || attempt >= EINTR_RETRY_CAP) throw error
    }
  }
}

async function publishFallback(lockPath: string, record: LockRecord): Promise<boolean> {
  let handle: FileHandle
  try {
    handle = await open(lockPath, "wx", 0o600)
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  }
  try {
    await (candidateFs.writeFallback ?? writeHandleAll)(handle, `${JSON.stringify(record)}\n`, "utf8")
    await handle.sync()
    return true
  } finally {
    await handle.close()
  }
}

export async function publishExclusive(lockPath: string, record: LockRecord): Promise<boolean> {
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 })
  const { candidatePath, handle } = await openFreshCandidate(lockPath)
  try {
    try {
      await writeHandleAll(handle, `${JSON.stringify(record)}\n`, "utf8")
      await handle.sync()
    } finally {
      await handle.close()
    }

    try {
      await (candidateFs.link ?? link)(candidatePath, lockPath)
      return true
    } catch (error) {
      if (isCandidatePublishRace(error)) return false
      // Awaited so the finally below removes the candidate only after the fallback settles; a bare
      // return would leave a fallback rejection unhandled while the candidate unlink is pending.
      if (LINK_FALLBACK_ERRORS.has(errorCode(error) ?? "")) return await publishFallback(lockPath, record)
      throw error
    }
  } finally {
    if (!(await unlinkCandidate(candidatePath))) rearmCandidateSweep(path.dirname(lockPath))
  }
}

// EEXIST: another contender published first. ENOENT: this candidate vanished mid-publish,
// which only another process's stale-candidate sweep can cause after CANDIDATE_STALE_AGE_MS;
// both are lost races the caller retries with a fresh candidate, never protocol failures.
export function isCandidatePublishRace(error: unknown): boolean {
  const code = errorCode(error)
  return code === "EEXIST" || code === "ENOENT"
}
