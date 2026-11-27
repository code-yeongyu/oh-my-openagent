import { hostname } from "node:os"

import { pidLiveness } from "../lifecycle/pid-liveness"
import { readProcessStartIdentity } from "../platform/native-process"

export { readProcessStartIdentity }

/**
 * Who holds a task record lock, and the proof that it is gone. A lock is removed by anyone but its
 * holder only when that holder is PROVEN dead: the pid is unknown to the kernel, or a live pid's
 * start identity contradicts the recorded one (the pid was recycled). An unknown liveness, another
 * host or an incomparable identity keeps the lock - the same policy memory-core's locks apply.
 *
 * Every read here is synchronous because `withTaskRecordLock` is: /proc on Linux, libproc and
 * kernel32 through `bun:ffi` on darwin and Windows (no process spawn per probe - #8096).
 */

export interface LockOwner {
  readonly pid: number
  /** `unavailable` when the holder could not read its own start identity, or wrote a legacy lock. */
  readonly startIdentity: string
  /** undefined for a legacy lock (written before owners carried a host); it is this host's. */
  readonly hostname: string | undefined
  readonly token: string
}

const UNAVAILABLE = "unavailable"
const OWN_IDENTITY_RETRY_FIRST_MS = 1_000
const OWN_IDENTITY_RETRY_MAX_MS = 60_000

/**
 * This process's start identity: a success is kept for the process lifetime (a live pid is never
 * reused), a failed read is retried after a doubling backoff capped at one minute, so one transient
 * failure does not leave every later lock without the identity that lets others prove this holder dead.
 */
export function createOwnStartIdentity(read: () => string | null, now: () => number): () => string {
  let known: string | undefined
  let retryAt = 0
  let backoffMs = OWN_IDENTITY_RETRY_FIRST_MS
  return () => {
    if (known !== undefined) return known
    const at = now()
    if (at < retryAt) return UNAVAILABLE
    const identity = read()
    if (identity !== null) {
      known = identity
      return identity
    }
    retryAt = at + backoffMs
    backoffMs = Math.min(backoffMs * 2, OWN_IDENTITY_RETRY_MAX_MS)
    return UNAVAILABLE
  }
}

const ownStartIdentity = createOwnStartIdentity(() => readProcessStartIdentity(process.pid), Date.now)

/** The body a holder writes: `pid`, acquisition time and token first, as every earlier build wrote them. */
export function formatLockBody(token: string): string {
  return `${process.pid}\n${Date.now()}\n${token}\n${ownStartIdentity()}\n${hostname()}\n`
}

/** undefined when the body is not a complete lock (a holder that died between create and write). */
export function parseLockOwner(body: string): LockOwner | undefined {
  const lines = body.split("\n")
  const [pidText, acquiredAt, token, startIdentity, host] = lines
  if (pidText === undefined || !/^[1-9]\d*$/.test(pidText)) return undefined
  if (acquiredAt === undefined || !/^\d+$/.test(acquiredAt)) return undefined
  if (token === undefined || token.length === 0) return undefined
  // A legacy body ends after the token; anything else must carry both owner fields.
  const legacy = lines.length === 4 && lines[3] === ""
  if (legacy) return { pid: Number(pidText), startIdentity: UNAVAILABLE, hostname: undefined, token }
  if (startIdentity === undefined || startIdentity.length === 0 || host === undefined || host.length === 0)
    return undefined
  return { pid: Number(pidText), startIdentity, hostname: host, token }
}

export function isLockOwnerProvenDead(owner: LockOwner): boolean {
  if (owner.hostname !== undefined && owner.hostname !== hostname()) return false
  const liveness = pidLiveness(owner.pid)
  if (liveness === "dead") return true
  if (liveness === "unknown" || owner.startIdentity === UNAVAILABLE) return false
  const actual = readProcessStartIdentity(owner.pid)
  return actual !== null && startIdentitiesConflict(owner.startIdentity, actual)
}

// Identities from different readers (schemes) are never compared: a mismatch proves death, so an
// incomparable pair must read as "no conflict" and the owner keeps its lock.
function startIdentitiesConflict(recorded: string, actual: string): boolean {
  const scheme = (identity: string): string => identity.slice(0, Math.max(0, identity.indexOf(":")))
  const recordedScheme = scheme(recorded)
  return recordedScheme.length > 0 && recordedScheme === scheme(actual) && recorded !== actual
}
