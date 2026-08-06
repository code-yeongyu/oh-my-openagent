import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acquireSessionAdmissionLease,
  admissionLeasePath,
  type AcquireAdmissionLeaseResult,
  type SessionAdmissionLease,
} from "./admission-lease"

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempStateDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-lease-"))
  cleanupRoots.push(directory)
  return directory
}

function acquired(result: AcquireAdmissionLeaseResult): SessionAdmissionLease {
  if (result.kind !== "acquired") throw new Error(`expected acquired, got ${result.kind}`)
  return result.lease
}

describe("acquireSessionAdmissionLease", () => {
  test("#given no lease on disk #when acquiring #then the lease file appears with the acquirer's token and release removes it", async () => {
    // given
    const stateDir = tempStateDir()

    // when
    const lease = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 40 }))

    // then
    expect(lease.path).toBe(admissionLeasePath(stateDir, "parent-1"))
    expect(existsSync(lease.path)).toBe(true)
    const body = JSON.parse(readFileSync(lease.path, "utf8")) as Record<string, unknown>
    expect(body.token).toBe(lease.token)
    expect(body.pid).toBe(process.pid)
    expect(typeof body.renewed_at).toBe("number")

    // and when released, a fresh acquisition succeeds immediately
    lease.release()
    expect(existsSync(lease.path)).toBe(false)
    const next = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 40 }))
    next.release()
  })

  test("#given a holder that keeps renewing #when a waiter contends past several stale windows #then the holder is NOT reclaimed and the waiter yields contended", async () => {
    // given: a live holder renewing every 40ms against a 120ms stale threshold
    const stateDir = tempStateDir()
    const timing = { renewMs: 40, staleMs: 120, acquireTimeoutMs: 300, retryMs: 10 }
    const holder = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", timing))

    // when: the waiter waits 300ms - two and a half stale windows - while the holder keeps renewing
    const waiter = await acquireSessionAdmissionLease(stateDir, "parent-1", timing)

    // then: the slow-but-alive holder was never reclaimed underneath itself
    expect(waiter.kind).toBe("contended")
    expect(holder.isOwner()).toBe(true)
    holder.release()
  })

  test("#given a crashed holder whose renewal stopped #when the lease goes stale #then a waiter takes over and the crashed holder's late release cannot delete the successor", async () => {
    // given: a holder that never renews (renewMs far beyond the test) simulates a crashed process
    const stateDir = tempStateDir()
    const crashed = acquired(
      await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 60_000, staleMs: 120, acquireTimeoutMs: 300, retryMs: 10 }),
    )

    // when: a waiter observes the stale lease and wins the takeover CAS
    const successor = acquired(
      await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 40, staleMs: 120, acquireTimeoutMs: 2_000, retryMs: 10 }),
    )

    // then: the successor fenced the crashed holder out
    expect(successor.token).not.toBe(crashed.token)
    expect(crashed.isOwner()).toBe(false)
    expect(successor.isOwner()).toBe(true)

    // and when the crashed holder finally "wakes" and releases, the successor's lease survives (release is a CAS)
    crashed.release()
    expect(successor.isOwner()).toBe(true)
    expect(existsSync(admissionLeasePath(stateDir, "parent-1"))).toBe(true)
    successor.release()
  })

  test("#given one stale lease and two racing waiters #when both attempt the takeover CAS #then exactly one wins and the loser never deletes the winner's lease", async () => {
    // given: a stale lease left by a crashed holder
    const stateDir = tempStateDir()
    const crashed = acquired(
      await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 60_000, staleMs: 150, acquireTimeoutMs: 300, retryMs: 10 }),
    )

    // when: two waiters race the takeover from the same starting gun
    const timing = { renewMs: 50, staleMs: 150, acquireTimeoutMs: 1_500, retryMs: 5 }
    const [first, second] = await Promise.all([
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
    ])

    // then: exactly one waiter won
    const winners = [first, second].filter((result) => result.kind === "acquired")
    expect(winners).toHaveLength(1)
    const winner = winners[0]
    if (winner === undefined || winner.kind !== "acquired") throw new Error("expected exactly one winner")
    expect(winner.lease.isOwner()).toBe(true)

    // and the loser's failed takeover plus the crashed holder's late release left the winner's lease intact
    crashed.release()
    expect(winner.lease.isOwner()).toBe(true)
    expect(existsSync(admissionLeasePath(stateDir, "parent-1"))).toBe(true)
    const body = JSON.parse(readFileSync(admissionLeasePath(stateDir, "parent-1"), "utf8")) as Record<string, unknown>
    expect(body.token).toBe(winner.lease.token)
    winner.lease.release()
    expect(existsSync(admissionLeasePath(stateDir, "parent-1"))).toBe(false)
  })
})
