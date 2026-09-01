import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getProcessStartIdentity } from "../locks"

import { withLocalJournalLock } from "./lock"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

function freshLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-journal-lock-"))
  dirs.push(dir)
  return join(dir, "state.lock")
}

describe("withLocalJournalLock", () => {
  test(
    "#given overlapping same-process acquisitions #when the holder outlasts the acquisition wait #then every contender still runs, serialized",
    async () => {
      // given
      const lockPath = freshLockPath()
      const order: string[] = []

      // when: one holder outlives the 5s acquisition wait while three contenders queue up
      await Promise.all([
        withLocalJournalLock(lockPath, async () => {
          order.push("a-start")
          await Bun.sleep(5_200)
          order.push("a-end")
        }),
        withLocalJournalLock(lockPath, async () => {
          order.push("b")
        }),
        withLocalJournalLock(lockPath, async () => {
          order.push("c")
        }),
        withLocalJournalLock(lockPath, async () => {
          order.push("d")
        }),
      ])

      // then: nobody failed with EEXIST and the tasks ran one at a time, in order
      expect(order).toEqual(["a-start", "a-end", "b", "c", "d"])
      expect(existsSync(lockPath)).toBe(false)
    },
    30_000,
  )

  test(
    "#given a stale lock whose live pid now belongs to a different process #when acquiring #then the reused-pid lock is reclaimed",
    async () => {
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
    },
    30_000,
  )

  test(
    "#given a live foreign owner that keeps the lock #when the acquisition wait expires #then a typed JournalLockTimeoutError is thrown",
    async () => {
      // given: a live foreign process recorded as the owner in the legacy pid-only shape
      const lockPath = freshLockPath()
      const child = Bun.spawn({
        cmd: [process.execPath, "-e", "setTimeout(() => undefined, 60_000)"],
        stdout: "ignore",
        stderr: "ignore",
      })
      try {
        writeFileSync(lockPath, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 })

        // when
        const failure = await withLocalJournalLock(lockPath, async () => "acquired").then(
          () => null,
          (error: unknown) => error,
        )

        // then: the failure is the typed contention error, never a raw EEXIST
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).name).toBe("JournalLockTimeoutError")
        expect((failure as { retriable?: unknown }).retriable).toBe(true)
      } finally {
        child.kill()
        await child.exited
      }
    },
    30_000,
  )
})
