import { afterEach, describe, expect, jest, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acquireSessionAdmissionLease,
  admissionLeasePath,
  type AcquireAdmissionLeaseResult,
  type SessionAdmissionLease,
  setAdmissionLeaseFsForTests,
} from "./admission-lease"

const cleanupRoots: string[] = []
const restoreLeaseFs: Array<() => void> = []

afterEach(() => {
  for (const restore of restoreLeaseFs.splice(0).reverse()) restore()
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempStateDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-lease-"))
  cleanupRoots.push(directory)
  return directory
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
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

  test("#given a link-published lease truncated by a power loss #when two contenders arrive after the incomplete grace #then one reclaims it and the other sees the new owner", async () => {
    // given: a normal link publication, then the empty durable state a power loss can leave
    const stateDir = tempStateDir()
    let now = Date.now()
    const timing = { renewMs: 60_000, staleMs: 1_000, incompleteGraceMs: 100, acquireTimeoutMs: 0, retryMs: 10, now: () => now }
    const original = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", timing))
    writeFileSync(original.path, "")
    now = statSync(original.path).mtimeMs

    // when: a contender arrives inside the incomplete-file grace period
    const early = await acquireSessionAdmissionLease(stateDir, "parent-1", timing)

    // then: the empty lease is held rather than stolen
    expect(early.kind).toBe("contended")
    expect(readFileSync(original.path, "utf8")).toBe("")

    // when: two contenders race after the injected clock passes the grace period
    now += 101
    const [first, second] = await Promise.all([
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
    ])

    // then: exactly one contender owns the replacement
    const winners = [first, second].filter((result) => result.kind === "acquired")
    expect(winners).toHaveLength(1)
    const winner = winners[0]
    if (winner === undefined || winner.kind !== "acquired") throw new Error("expected exactly one winner")
    expect(winner.lease.isOwner()).toBe(true)
    original.release()
    expect(winner.lease.isOwner()).toBe(true)
    winner.lease.release()
  })

  test("#given link EACCES #when two contenders race the exclusive-create fallback #then exactly one wins", async () => {
    // given
    const stateDir = tempStateDir()
    restoreLeaseFs.push(setAdmissionLeaseFsForTests({ linkSync: () => { throw codedError("EACCES") } }))
    const timing = { renewMs: 60_000, acquireTimeoutMs: 0, retryMs: 10 }

    // when
    const [first, second] = await Promise.all([
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
      acquireSessionAdmissionLease(stateDir, "parent-1", timing),
    ])

    // then
    const winners = [first, second].filter((result) => result.kind === "acquired")
    expect(winners).toHaveLength(1)
    expect([first, second].filter((result) => result.kind === "contended")).toHaveLength(1)
    const winner = winners[0]
    if (winner === undefined || winner.kind !== "acquired") throw new Error("expected exactly one winner")
    expect(winner.lease.isOwner()).toBe(true)
    winner.lease.release()
  })

  for (const code of ["EPERM", "ENOTSUP"]) {
    test(`#given link ${code} #when a lease is published #then the exclusive-create fallback succeeds`, async () => {
      const stateDir = tempStateDir()
      restoreLeaseFs.push(setAdmissionLeaseFsForTests({ linkSync: () => { throw codedError(code) } }))

      const lease = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 60_000 }))

      expect(lease.isOwner()).toBe(true)
      lease.release()
    })
  }

  test("#given the fallback writer crashes after exclusive create #when contenders arrive across the grace boundary #then the empty lease is held before one contender reclaims it", async () => {
    // given
    const stateDir = tempStateDir()
    let now = Date.now()
    const timing = { renewMs: 60_000, staleMs: 1_000, incompleteGraceMs: 100, acquireTimeoutMs: 0, retryMs: 10, now: () => now }
    restoreLeaseFs.push(setAdmissionLeaseFsForTests({
      linkSync: () => { throw codedError("EACCES") },
      writeFallback: () => { throw new Error("simulated writer crash") },
    }))
    await expect(acquireSessionAdmissionLease(stateDir, "parent-1", timing)).rejects.toThrow("simulated writer crash")
    const path = admissionLeasePath(stateDir, "parent-1")
    expect(readFileSync(path, "utf8")).toBe("")
    restoreLeaseFs.pop()?.()
    restoreLeaseFs.push(setAdmissionLeaseFsForTests({ linkSync: () => { throw codedError("EACCES") } }))
    now = statSync(path).mtimeMs

    // when / then: held during grace
    expect((await acquireSessionAdmissionLease(stateDir, "parent-1", timing)).kind).toBe("contended")

    // when / then: stale after grace and recoverable
    now += 101
    const replacement = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", timing))
    expect(replacement.isOwner()).toBe(true)
    replacement.release()
  })

  test("#given a non-fallback link error #when a lease is published #then the original error is thrown", async () => {
    const stateDir = tempStateDir()
    restoreLeaseFs.push(setAdmissionLeaseFsForTests({ linkSync: () => { throw codedError("EIO") } }))

    await expect(acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 60_000 })).rejects.toMatchObject({ code: "EIO" })
  })

  test("#given a holder renewing on virtual time #when several stale windows pass before a waiter contends #then the holder is NOT reclaimed and the waiter yields contended", async () => {
    jest.useFakeTimers()
    try {
      // given: a real holder renews every 40ms against a 120ms stale threshold
      const stateDir = tempStateDir()
      const timing = { renewMs: 40, staleMs: 120, acquireTimeoutMs: 0, retryMs: 10 }
      const holder = acquired(await acquireSessionAdmissionLease(stateDir, "parent-1", timing))

      // when: virtual time runs ten renewal ticks before an immediate contention attempt
      jest.advanceTimersByTime(400)
      const waiter = await acquireSessionAdmissionLease(stateDir, "parent-1", timing)

      // then: the live holder's on-disk token stayed fresh and was never reclaimed
      expect(waiter.kind).toBe("contended")
      expect(holder.isOwner()).toBe(true)
      holder.release()
    } finally {
      jest.useRealTimers()
    }
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
    jest.useFakeTimers()
    try {
      // given: a stale lease left by a crashed holder, aged past its stale window on virtual time
      const stateDir = tempStateDir()
      const crashed = acquired(
        await acquireSessionAdmissionLease(stateDir, "parent-1", { renewMs: 60_000, staleMs: 150, acquireTimeoutMs: 300, retryMs: 10 }),
      )
      jest.advanceTimersByTime(200)

      // when: two waiters race the takeover from the same starting gun. The winner's renewals and
      // the loser's bounded wait both run on virtual time, so which one wins is decided by the CAS
      // alone - never by a scheduler pause that lets the loser reclaim a live winner.
      const timing = { renewMs: 50, staleMs: 150, acquireTimeoutMs: 1_500, retryMs: 5 }
      const race = Promise.all([
        acquireSessionAdmissionLease(stateDir, "parent-1", timing),
        acquireSessionAdmissionLease(stateDir, "parent-1", timing),
      ])
      for (let tick = 0; tick < 40; tick += 1) {
        jest.advanceTimersByTime(timing.renewMs)
        await Promise.resolve()
        await Promise.resolve()
      }
      const [first, second] = await race

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
    } finally {
      jest.useRealTimers()
    }
  })
})
