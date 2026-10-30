import { randomBytes } from "node:crypto"
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { withTaskRecordLock } from "../store/record-lock"
import { waitForAdmissionLease, wakeAdmissionLeaseWaiters } from "./admission-lease-wait"

/**
 * Crash-safe per-parent-session admission lease (`<stateDir>/locks/session-<parentSessionId>.lock`).
 *
 * Why not `withTaskRecordLock` for the batch itself: that primitive is a mutex for sub-10ms record
 * writes. It is taken from a holder only once the holder is proven dead (store/lock-owner.ts), and a
 * waiter gives up after one holder keeps it for 1s - blocking its thread meanwhile in the sync
 * variant. A batch admission section is longer-lived, so waiters behind it would time out, and a
 * holder that is alive but no longer renewing could never be taken over. This
 * lease is a RENEWABLE OWNER-TOKEN lease instead: the body is `{pid, token, renewed_at}`, the
 * holder refreshes `renewed_at` on a timer, and `token` (minted fresh per acquisition) is the
 * fencing token. Takeover is a compare-and-swap that re-validates BOTH the observed token and the
 * staleness under a short mutex, so a holder that renewed between a waiter's observation and its
 * CAS is never displaced. The mutex (`withTaskRecordLock`) only ever guards sub-10ms
 * read-check-rename sections - exactly what it was built for.
 */

export type AdmissionLeaseTiming = {
  // Holder-side refresh interval for `renewed_at`.
  readonly renewMs: number
  // A lease whose `renewed_at` is older than this is takeover-eligible. Defaults to 3 refresh
  // intervals so one wedged renewal tick never displaces a live holder.
  readonly staleMs: number
  // Bounded wait for acquisition; past it the caller yields deferred/lock_contended (never throws).
  readonly acquireTimeoutMs: number
  readonly retryMs: number
  readonly incompleteGraceMs: number
  readonly now: () => number
}

export type SessionAdmissionLease = {
  // The fencing token minted for THIS acquisition.
  readonly token: string
  readonly path: string
  // Holder-side fencing: re-read the lease and report whether `token` is still ours. Checked
  // before every mutation inside the critical section; a false means the batch must abort.
  readonly isOwner: () => boolean
  // CAS release: the lease file is removed ONLY if the on-disk token is still ours, so a displaced
  // holder never deletes its successor's lease on the way out.
  readonly release: () => void
}

export type AcquireAdmissionLeaseResult =
  | { readonly kind: "acquired"; readonly lease: SessionAdmissionLease }
  | { readonly kind: "contended" }

type LeaseBody = {
  readonly pid: number
  readonly token: string
  readonly renewed_at: number
}

type IncompleteLease = {
  readonly incomplete: true
  readonly dev: number
  readonly ino: number
  readonly mtimeMs: number
}

type LeaseSnapshot = LeaseBody | IncompleteLease | "missing"

export interface AdmissionLeaseFs {
  readonly linkSync?: typeof linkSync
  readonly writeFallback?: (fd: number, content: string) => void
}

let leaseFs: AdmissionLeaseFs = {}

export function setAdmissionLeaseFsForTests(next: AdmissionLeaseFs | undefined): () => void {
  const previous = leaseFs
  leaseFs = next ?? {}
  return () => { leaseFs = previous }
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_MS = 25
const DEFAULT_INCOMPLETE_GRACE_MS = 5_000
const LINK_FALLBACK_ERRORS = new Set(["EACCES", "EPERM", "ENOTSUP"])

export function admissionLeasePath(stateDir: string, parentSessionId: string): string {
  return join(stateDir, "locks", `session-${parentSessionId}.lock`)
}

export function resolveAdmissionLeaseTiming(overrides: Partial<AdmissionLeaseTiming> = {}): AdmissionLeaseTiming {
  const renewMs = overrides.renewMs ?? 1_000
  return {
    renewMs,
    staleMs: overrides.staleMs ?? renewMs * 3,
    acquireTimeoutMs: overrides.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
    retryMs: overrides.retryMs ?? DEFAULT_RETRY_MS,
    incompleteGraceMs: overrides.incompleteGraceMs ?? DEFAULT_INCOMPLETE_GRACE_MS,
    now: overrides.now ?? Date.now,
  }
}

export function acquireSessionAdmissionLease(
  stateDir: string,
  parentSessionId: string,
  overrides: Partial<AdmissionLeaseTiming> = {},
): Promise<AcquireAdmissionLeaseResult> {
  try {
    const timing = resolveAdmissionLeaseTiming(overrides)
    const path = admissionLeasePath(stateDir, parentSessionId)
    mkdirSync(join(stateDir, "locks"), { recursive: true })
    const token = randomBytes(16).toString("hex")
    const startedAt = timing.now()
    const attempt = (): AcquireAdmissionLeaseResult | undefined => {
      for (;;) {
        if (tryCreateLease(path, { pid: process.pid, token, renewed_at: timing.now() })) {
          return { kind: "acquired", lease: startHolder(path, token, timing) }
        }
        const observed = readLeaseBody(path)
        if (observed === "missing") continue // released between create and read
        const stale = isIncompleteLease(observed)
          ? timing.now() - observed.mtimeMs > timing.incompleteGraceMs
          : timing.now() - observed.renewed_at > timing.staleMs
        if (stale && tryTakeover(path, observed, token, timing)) {
          return { kind: "acquired", lease: startHolder(path, token, timing) }
        }
        return timing.now() - startedAt >= timing.acquireTimeoutMs ? { kind: "contended" } : undefined
      }
    }
    // Register the waiter before the first attempt so a same-tick release cannot be lost between
    // a failed tryCreate and waitForAdmissionLease. The waiter retries immediately after arming.
    return waitForAdmissionLease(path, timing.retryMs, attempt)
  } catch (error) {
    return Promise.reject(error)
  }
}

// Exclusive create with COMPLETE content: write the body to a temp file, then link it into place
// atomically (EEXIST means someone else holds the lease). A reader never sees a partial body on a
// live machine because writeFileSync completes before linkSync publishes the candidate.
function publishLeaseFallback(path: string, body: LeaseBody): boolean {
  let fd: number
  try {
    fd = openSync(path, "wx", 0o600)
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false
    throw error
  }
  try {
    const content = JSON.stringify(body)
    if (leaseFs.writeFallback === undefined) writeFileSync(fd, content, "utf8")
    else leaseFs.writeFallback(fd, content)
    fsyncSync(fd)
    return true
  } finally {
    closeSync(fd)
  }
}

function tryCreateLease(path: string, body: LeaseBody): boolean {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(body), "utf8")
    try {
      (leaseFs.linkSync ?? linkSync)(tmp, path)
      return true
    } catch (error) {
      if (hasCode(error, "EEXIST")) return false
      if (LINK_FALLBACK_ERRORS.has(errorCode(error) ?? "")) return publishLeaseFallback(path, body)
      throw error
    }
  } finally {
    rmSync(tmp, { force: true })
  }
}

// The fenced takeover CAS. Runs under the short record mutex so the re-validation and the rename
// are one serialized section: the takeover lands ONLY if the on-disk token still equals the token
// observed at the start of the attempt AND the lease is still stale (a holder that renewed between
// our observation and the mutex is left alone). Never delete-then-create; the loser changes nothing.
function tryTakeover(path: string, observed: LeaseBody | IncompleteLease, token: string, timing: AdmissionLeaseTiming): boolean {
  try {
    return withTaskRecordLock(path, () => {
      const fresh = readLeaseBody(path)
      if (fresh === "missing") return false
      if (isIncompleteLease(observed) || isIncompleteLease(fresh)) {
        // An incomplete body has no token to fence on. Take it over only while it is still the same
        // old inode observed before the mutex; a live fallback writer remains held during grace.
        if (!isIncompleteLease(observed) || !isIncompleteLease(fresh) || !sameIncompleteLease(fresh, observed)) return false
        if (timing.now() - fresh.mtimeMs <= timing.incompleteGraceMs) return false
        writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: timing.now() })
        return true
      }
      if (fresh.token !== observed.token) return false // another waiter won the CAS first
      if (timing.now() - fresh.renewed_at <= timing.staleMs) return false // the holder renewed meanwhile
      writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: timing.now() })
      return true
    })
  } catch {
    return false // mutex contention timeout: the acquire loop retries or yields contended
  }
}

function startHolder(path: string, token: string, timing: AdmissionLeaseTiming): SessionAdmissionLease {
  // Renewal goes through the same mutex as takeover so a waiter's CAS always sees the freshest
  // renewed_at; if the token no longer matches we were displaced and stop renewing someone else's
  // lease. One wedged tick (mutex timeout) is survivable - the next tick retries.
  const timer = setInterval(() => {
    try {
      withTaskRecordLock(path, () => {
        const fresh = readLeaseBody(path)
        if (fresh === "missing" || isIncompleteLease(fresh) || fresh.token !== token) {
          clearInterval(timer)
          return
        }
        writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: timing.now() })
      })
    } catch {
      // skipped tick; staleMs spans 3 intervals by default, so a single miss never displaces us
    }
  }, timing.renewMs)
  timer.unref()

  return {
    token,
    path,
    isOwner: () => {
      const fresh = readLeaseBody(path)
      return fresh !== "missing" && !isIncompleteLease(fresh) && fresh.token === token
    },
    release: () => {
      clearInterval(timer)
      let released = false
      try {
        withTaskRecordLock(path, () => {
          const fresh = readLeaseBody(path)
          if (fresh !== "missing" && !isIncompleteLease(fresh) && fresh.token === token) {
            rmSync(path, { force: true })
            released = true
          }
        })
      } catch {
        // mutex timeout on the way out: the lease goes stale and a waiter takes it over
      }
      if (released) wakeAdmissionLeaseWaiters(path)
    },
  }
}

function readLeaseBody(path: string): LeaseSnapshot {
  if (!existsSync(path)) return "missing"
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return incompleteLease(path)
  }
  if (typeof parsed !== "object" || parsed === null) return incompleteLease(path)
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.pid !== "number" || typeof candidate.token !== "string" || typeof candidate.renewed_at !== "number") {
    return incompleteLease(path)
  }
  return { pid: candidate.pid, token: candidate.token, renewed_at: candidate.renewed_at }
}

function incompleteLease(path: string): LeaseSnapshot {
  try {
    const identity = statSync(path)
    return { incomplete: true, dev: identity.dev, ino: identity.ino, mtimeMs: identity.mtimeMs }
  } catch (error) {
    if (hasCode(error, "ENOENT")) return "missing"
    throw error
  }
}

function isIncompleteLease(value: LeaseSnapshot): value is IncompleteLease {
  return value !== "missing" && "incomplete" in value
}

function sameIncompleteLease(left: IncompleteLease, right: IncompleteLease): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs
}

// Atomic content replacement, exactly as record-store.ts:206-208 does: temp file then rename.
function writeLeaseAtomic(path: string, body: LeaseBody): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  writeFileSync(tmp, JSON.stringify(body), "utf8")
  renameSync(tmp, path)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined
}

function hasCode(error: unknown, expected: string): boolean {
  return errorCode(error) === expected
}
