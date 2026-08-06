import { randomBytes } from "node:crypto"
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { withTaskRecordLock } from "../store/record-lock"
import { delay } from "./context"

/**
 * Crash-safe per-parent-session admission lease (`<stateDir>/locks/session-<parentSessionId>.lock`).
 *
 * Why not `withTaskRecordLock` for the batch itself: that primitive stale-reclaims after 5s by
 * mtime because it guards sub-10ms record writes (store/record-lock.ts:5-9). A batch admission
 * section is longer-lived, so a slow-but-alive holder would be reclaimed underneath itself. This
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

const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000
const DEFAULT_RETRY_MS = 25

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
  }
}

export async function acquireSessionAdmissionLease(
  stateDir: string,
  parentSessionId: string,
  overrides: Partial<AdmissionLeaseTiming> = {},
): Promise<AcquireAdmissionLeaseResult> {
  const timing = resolveAdmissionLeaseTiming(overrides)
  const path = admissionLeasePath(stateDir, parentSessionId)
  mkdirSync(join(stateDir, "locks"), { recursive: true })
  const token = randomBytes(16).toString("hex")
  const startedAt = Date.now()

  for (;;) {
    if (tryCreateLease(path, { pid: process.pid, token, renewed_at: Date.now() })) {
      return { kind: "acquired", lease: startHolder(path, token, timing) }
    }
    const observed = readLeaseBody(path)
    if (observed === "missing") continue // released between our create attempt and this read
    const stale = observed === "corrupt" || Date.now() - observed.renewed_at > timing.staleMs
    if (stale && tryTakeover(path, observed, token, timing.staleMs)) {
      return { kind: "acquired", lease: startHolder(path, token, timing) }
    }
    if (Date.now() - startedAt >= timing.acquireTimeoutMs) return { kind: "contended" }
    await delay(timing.retryMs)
  }
}

// Exclusive create with COMPLETE content: write the body to a temp file, then link it into place
// atomically (EEXIST means someone else holds the lease). A reader never sees a partial body.
function tryCreateLease(path: string, body: LeaseBody): boolean {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(body), "utf8")
    linkSync(tmp, path)
    return true
  } catch (error) {
    if (hasCode(error, "EEXIST")) return false
    throw error
  } finally {
    rmSync(tmp, { force: true })
  }
}

// The fenced takeover CAS. Runs under the short record mutex so the re-validation and the rename
// are one serialized section: the takeover lands ONLY if the on-disk token still equals the token
// observed at the start of the attempt AND the lease is still stale (a holder that renewed between
// our observation and the mutex is left alone). Never delete-then-create; the loser changes nothing.
function tryTakeover(path: string, observed: LeaseBody | "corrupt", token: string, staleMs: number): boolean {
  try {
    return withTaskRecordLock(path, () => {
      const fresh = readLeaseBody(path)
      if (fresh === "missing") return false
      if (observed === "corrupt" || fresh === "corrupt") {
        // A corrupt body has no token to fence on; take over only if it is STILL corrupt (nobody
        // repaired it into a live lease between our observation and the mutex).
        if (fresh !== "corrupt") return false
        writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: Date.now() })
        return true
      }
      if (fresh.token !== observed.token) return false // another waiter won the CAS first
      if (Date.now() - fresh.renewed_at <= staleMs) return false // the holder renewed meanwhile
      writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: Date.now() })
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
        if (fresh === "missing" || fresh === "corrupt" || fresh.token !== token) {
          clearInterval(timer)
          return
        }
        writeLeaseAtomic(path, { pid: process.pid, token, renewed_at: Date.now() })
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
      return fresh !== "missing" && fresh !== "corrupt" && fresh.token === token
    },
    release: () => {
      clearInterval(timer)
      try {
        withTaskRecordLock(path, () => {
          const fresh = readLeaseBody(path)
          if (fresh !== "missing" && fresh !== "corrupt" && fresh.token === token) rmSync(path, { force: true })
        })
      } catch {
        // mutex timeout on the way out: the lease goes stale and a waiter takes it over
      }
    },
  }
}

function readLeaseBody(path: string): LeaseBody | "missing" | "corrupt" {
  if (!existsSync(path)) return "missing"
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return "corrupt"
  }
  if (typeof parsed !== "object" || parsed === null) return "corrupt"
  const candidate = parsed as Record<string, unknown>
  if (typeof candidate.pid !== "number" || typeof candidate.token !== "string" || typeof candidate.renewed_at !== "number") {
    return "corrupt"
  }
  return { pid: candidate.pid, token: candidate.token, renewed_at: candidate.renewed_at }
}

// Atomic content replacement, exactly as record-store.ts:206-208 does: temp file then rename.
function writeLeaseAtomic(path: string, body: LeaseBody): void {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
  writeFileSync(tmp, JSON.stringify(body), "utf8")
  renameSync(tmp, path)
}

function hasCode(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error && error.code === expected
}
