import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getProcessStartIdentity } from "../locks"

import { ACQUISITION_WAIT_MS, withLocalJournalLock } from "./lock"
import { removeTreeSync } from "../../../../test-support/remove-tree"

const dirs: string[] = []
const realDateNow = Date.now
afterEach(() => {
  Date.now = realDateNow
  for (const dir of dirs.splice(0)) {
    removeTreeSync(dir, { maxRetries: 10, retryDelay: 200 })
  }
})

function freshLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-journal-lock-"))
  dirs.push(dir)
  return join(dir, "state.lock")
}

// lock.ts measures its acquisition wait with Date.now() and nothing else, so these tests drive that clock instead of
// sleeping through the wait in real time. The clock only moves when a test sets it. Tests reason about WHEN the lock
// reads the clock (at which time, in which phase), never about how many readings a phase takes.
function installLockClock(start: number) {
  let now = start
  const values: number[] = []
  const waiters: Array<{ readonly at: number; readonly resolve: (value: undefined) => void }> = []
  Date.now = () => {
    const value = now
    values.push(value)
    for (const waiter of waiters.filter((candidate) => candidate.at === value)) {
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve(undefined)
    }
    return value
  }
  return {
    set: (time: number) => {
      now = time
    },
    /** Every reading so far, in order. */
    values,
    /** Resolves at the next reading taken while the clock stands at `at`. Subscribe before moving the clock. */
    nextReadingAt: (at: number): Promise<undefined> => {
      const { promise, resolve } = Promise.withResolvers<undefined>()
      waiters.push({ at, resolve })
      return promise
    },
  }
}

function rejectAfter(milliseconds: number, message: string): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

describe("withLocalJournalLock", () => {
  test("#given a held FIFO predecessor #when a queued contender is cancelled #then it returns before the holder and never enters", async () => {
    const lockPath = freshLockPath()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    const reason = new Error("observer retired")
    const order: string[] = []
    const holder = withLocalJournalLock(lockPath, async () => {
      entered.resolve()
      await release.promise
      order.push("holder")
    })
    await entered.promise
    const cancelled = withLocalJournalLock(
      lockPath,
      async () => {
        order.push("cancelled")
      },
      controller.signal,
    ).then(
      () => undefined,
      (error: unknown) => error,
    )
    controller.abort(reason)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        cancelled,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("FIFO cancellation did not settle")), 2_000)
        }),
      ])
      expect(result).toBe(reason)
      expect(order).toEqual([])
      expect(existsSync(lockPath)).toBe(true)
    } finally {
      clearTimeout(timer)
      release.resolve()
      await holder
      await cancelled
    }
    await withLocalJournalLock(lockPath, async () => {
      order.push("next")
    })
    expect(order).toEqual(["holder", "next"])
    expect(existsSync(lockPath)).toBe(false)
  })

  test("#given overlapping same-process acquisitions #when the holder outlasts the acquisition wait #then every contender still runs, serialized", async () => {
    // given
    const lockPath = freshLockPath()
    const order: string[] = []
    // Enqueueing happens while the clock stands at `enqueuedAt`; the turns run only after it has moved on.
    const enqueuedAt = realDateNow()
    const turnsBeginAt = enqueuedAt + 1
    const clock = installLockClock(enqueuedAt)

    // when: one holder outlives the 5s acquisition wait on the lock's clock while three contenders queue up
    const holder = withLocalJournalLock(lockPath, async () => {
      order.push("a-start")
      // The task runs after the holder wrote its pid payload, so the jump never meets a payload-free lock
      // file (whose reclaim compares Date.now() against the file's real mtime).
      clock.set(turnsBeginAt + ACQUISITION_WAIT_MS + 200)
      expect(readFileSync(lockPath, "utf8").split("\n")[0]).toBe(String(process.pid))
      order.push("a-end")
    })
    const contenders = ["b", "c", "d"].map((name) =>
      withLocalJournalLock(lockPath, async () => {
        order.push(name)
      }),
    )
    clock.set(turnsBeginAt)
    await Promise.all([holder, ...contenders])

    // then: nobody failed with EEXIST and the tasks ran one at a time, in order
    expect(order).toEqual(["a-start", "a-end", "b", "c", "d"])
    expect(existsSync(lockPath)).toBe(false)
    // and no acquisition read the clock while enqueueing: each contender's wait starts on its own turn, so no
    // deadline can run out while the holder still holds the lock
    expect(clock.values).not.toContain(enqueuedAt)
  }, 30_000)

  test("#given a stale lock whose live pid now belongs to a different process #when acquiring #then the reused-pid lock is reclaimed", async () => {
    // given: the payload claims this live pid with a start identity that is not ours
    const lockPath = freshLockPath()
    writeFileSync(lockPath, `${process.pid}\nps-lstart: Jan  1 00:00:00 2000\n`, {
      encoding: "utf8",
      mode: 0o600,
    })

    const ownIdentity = await getProcessStartIdentity(process.pid)
    if (ownIdentity === null) {
      // when: the platform offers no start identity (win32), so the owner stays unverifiable
      const failure = await withLocalJournalLock(lockPath, async () => "acquired").then(
        () => null,
        (error: unknown) => error,
      )
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).name).toBe("JournalLockTimeoutError")
      return
    }

    // when / then: the mismatched start identity proves the owner is gone, so it is reclaimed
    const result = await withLocalJournalLock(lockPath, async () => "acquired")
    expect(result).toBe("acquired")
    expect(existsSync(lockPath)).toBe(false)
  }, 30_000)

  test("#given a live foreign owner that keeps the lock #when the acquisition wait expires #then a typed JournalLockTimeoutError is thrown", async () => {
    // given: a live foreign process recorded as the owner in the legacy pid-only shape
    const lockPath = freshLockPath()
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", "setTimeout(() => undefined, 60_000)"],
      stdout: "ignore",
      stderr: "ignore",
    })
    try {
      writeFileSync(lockPath, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 })
      // The production contract: a contender waits 5 s for a live owner before giving up.
      expect(ACQUISITION_WAIT_MS).toBe(5_000)
      const start = realDateNow()
      const deadline = start + ACQUISITION_WAIT_MS
      const clock = installLockClock(start)
      const guard = rejectAfter(10_000, "acquisition did not give up after its clock reached the wait")
      // A retry consults the live owner (a signal-0 probe of its pid) only after a deadline check let it continue, so a
      // probe is the role signal for "kept retrying", however many times an attempt reads the clock.
      const realKill = process.kill
      const ownerProbes: Array<(value: undefined) => void> = []
      process.kill = ((pid: number, signal?: string | number) => {
        if (pid === child.pid && signal === 0) for (const probed of ownerProbes.splice(0)) probed(undefined)
        return realKill.call(process, pid, signal)
      }) as typeof process.kill
      const nextOwnerProbe = (): Promise<undefined> => {
        const { promise, resolve } = Promise.withResolvers<undefined>()
        ownerProbes.push(resolve)
        return promise
      }
      const tookItsTurn = clock.nextReadingAt(start)

      // when: the contender takes its turn at `start`, then the clock stands 1 ms short of the deadline, then reaches it
      const acquisition = withLocalJournalLock(lockPath, async () => "acquired").then(
        () => null,
        (error: unknown) => error,
      )
      const settled = acquisition.then(() => "settled" as const)
      try {
        // Its turn reads the clock at `start`: the wait is measured from there.
        expect(await Promise.race([tookItsTurn.then(() => "took its turn" as const), settled, guard.promise])).toBe(
          "took its turn",
        )
        // 1 ms short of the deadline it keeps retrying: after reading the clock there, it goes on to consult the owner.
        // (The clock moves before the first attempt's open() can fail, so every deadline check from here reads it.)
        const shortOfDeadline = clock.nextReadingAt(deadline - 1)
        clock.set(deadline - 1)
        const keptRetrying = shortOfDeadline.then(nextOwnerProbe).then(() => "kept retrying" as const)
        expect(await Promise.race([keptRetrying, settled, guard.promise])).toBe("kept retrying")
        // Once the clock reaches the deadline it gives up; the guard fires only if it never does.
        clock.set(deadline)
        expect(await Promise.race([settled, guard.promise])).toBe("settled")
      } finally {
        guard.cancel()
        process.kill = realKill
      }
      const failure = await acquisition

      // then: the failure is the typed contention error, never a raw EEXIST
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).name).toBe("JournalLockTimeoutError")
      expect((failure as { retriable?: unknown }).retriable).toBe(true)
      // The live owner's lock survives: the timeout came from the expired wait, not from a reclaim.
      expect(readFileSync(lockPath, "utf8")).toBe(`${child.pid}\n`)
    } finally {
      child.kill()
      await child.exited
    }
  }, 30_000)
})
