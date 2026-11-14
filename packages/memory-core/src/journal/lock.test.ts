import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getProcessStartIdentity } from "../locks"

import { withLocalJournalLock } from "./lock"
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

// Mirrors ACQUISITION_WAIT_MS in ./lock.ts.
const ACQUISITION_WAIT_MS = 5_000

// lock.ts measures its acquisition wait with Date.now() and nothing else, so these tests drive that
// clock instead of sleeping through the wait in real time. The clock only moves when a test moves it;
// `values` records every reading in order, and `onRead` runs after a reading has been taken.
function installLockClock(start: number, onRead?: (reads: number) => void) {
  let now = start
  const values: number[] = []
  const clock = {
    advance: (milliseconds: number) => {
      now += milliseconds
    },
    get reads() {
      return values.length
    },
    values,
  }
  Date.now = () => {
    const value = now
    values.push(value)
    onRead?.(values.length)
    return value
  }
  return clock
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
    const clock = installLockClock(realDateNow())

    // when: one holder outlives the 5s acquisition wait on the lock's clock while three contenders queue up
    const holder = withLocalJournalLock(lockPath, async () => {
      order.push("a-start")
      // The task runs after the holder wrote its pid payload, so the jump never meets a payload-free lock
      // file (whose reclaim compares Date.now() against the file's real mtime).
      clock.advance(ACQUISITION_WAIT_MS + 200)
      expect(readFileSync(lockPath, "utf8").split("\n")[0]).toBe(String(process.pid))
      order.push("a-end")
    })
    const contenders = ["b", "c", "d"].map((name) =>
      withLocalJournalLock(lockPath, async () => {
        order.push(name)
      }),
    )
    // A queued contender starts its acquisition wait only on its turn: enqueueing reads no clock, so no
    // deadline can run out while the holder still holds the lock.
    expect(clock.reads).toBe(0)
    await Promise.all([holder, ...contenders])

    // then: nobody failed with EEXIST and the tasks ran one at a time, in order
    expect(order).toEqual(["a-start", "a-end", "b", "c", "d"])
    expect(existsSync(lockPath)).toBe(false)
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
      // Read 1 sets the deadline (start + wait). Reads 2-4 stand 1 ms short of it, so the contender must keep
      // retrying (and keep consulting the live owner); read 5 reaches the deadline exactly.
      const start = realDateNow()
      const clock = installLockClock(start, (reads) => {
        if (reads === 1) clock.advance(ACQUISITION_WAIT_MS - 1)
        if (reads === 4) clock.advance(1)
      })

      // when
      const guard = rejectAfter(10_000, "acquisition did not give up after its clock passed the wait")
      const failure = await Promise.race([
        withLocalJournalLock(lockPath, async () => "acquired").then(
          () => null,
          (error: unknown) => error,
        ),
        guard.promise,
      ]).finally(guard.cancel)

      // then: the failure is the typed contention error, never a raw EEXIST
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).name).toBe("JournalLockTimeoutError")
      expect((failure as { retriable?: unknown }).retriable).toBe(true)
      // It gave up on the first reading at the deadline and never one reading earlier.
      const shortOfDeadline = start + ACQUISITION_WAIT_MS - 1
      expect(clock.values).toEqual([
        start,
        shortOfDeadline,
        shortOfDeadline,
        shortOfDeadline,
        start + ACQUISITION_WAIT_MS,
      ])
      // The live owner's lock survives: the timeout came from the expired wait, not from a reclaim.
      expect(readFileSync(lockPath, "utf8")).toBe(`${child.pid}\n`)
    } finally {
      child.kill()
      await child.exited
    }
  }, 30_000)
})
