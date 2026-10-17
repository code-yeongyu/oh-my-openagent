import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  removeWhenReleased,
  rmEfaultTolerant,
  rmSyncEfaultTolerant,
  TEARDOWN_FAILURE_PREFIX,
  type RmSyncFn,
  type SleepSyncFn,
} from "./teardown.test-support"

function errno(code: string, message = `${code}: simulated`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

const retryableCodes = ["EFAULT", "EBUSY", "EPERM", "ENOTEMPTY"]
const removers = [
  {
    name: "rmSyncEfaultTolerant",
    run: (path: string, remove: RmSyncFn, sleep: SleepSyncFn) =>
      rmSyncEfaultTolerant(path, { recursive: true, force: true }, { rmSync: remove, sleep }),
  },
  {
    name: "rmEfaultTolerant",
    run: (path: string, remove: RmSyncFn, sleep: SleepSyncFn) =>
      rmEfaultTolerant(path, { recursive: true, force: true }, {
        rm: async (target, options) => remove(target, options),
        sleep: async (ms) => sleep(ms),
      }),
  },
]

for (const { name, run } of removers) {
  describe(name, () => {
    test.each(retryableCodes)("#given one %s failure #when teardown runs #then it retries and succeeds", async (code) => {
      let calls = 0
      const delays: number[] = []
      await run("unused", () => {
        if (++calls === 1) throw errno(code)
      }, (ms) => { delays.push(ms) })
      expect(calls).toBe(2)
      expect(delays).toEqual([50])
    })

    test.each(retryableCodes)("#given persistent %s #when the retry budget expires #then errno and original cause survive the diagnostic wrapper", async (code) => {
      const cause = errno(code)
      const delays: number[] = []
      let calls = 0
      let failure: unknown
      try {
        await run("fixture-root", () => { calls++; throw cause }, (ms) => { delays.push(ms) })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        code,
        cause,
        message: `${TEARDOWN_FAILURE_PREFIX} ${code} persisted after 3 attempts removing fixture-root`,
      })
      expect((failure as Error).cause).toBe(cause)
      expect(calls).toBe(3)
      expect(delays).toEqual([50, 50])
    })

    test.each([errno("ENOENT"), errno("EACCES"), errno("EIO"), new Error("unknown"), { code: 1 }, null, "failure"])(
      "#given nonretryable failure %p #when teardown runs #then the original value escapes without retrying",
      async (cause) => {
        let calls = 0
        let sleeps = 0
        let failure: unknown
        try {
          await run("unused", () => { calls++; throw cause }, () => { sleeps++ })
        } catch (error) {
          failure = error
        }
        expect(failure).toBe(cause)
        expect(calls).toBe(1)
        expect(sleeps).toBe(0)
      },
    )

    test("#given an inherited errno #when retries exhaust #then the inherited code and original Error remain available", async () => {
      class BusyError extends Error {
        get code(): string { return "EBUSY" }
      }
      const cause = new BusyError("inherited errno")
      let failure: unknown
      try {
        await run("unused", () => { throw cause }, () => {})
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: "EBUSY" })
      expect((failure as Error).cause).toBe(cause)
    })
  })
}

describe("removeWhenReleased", () => {
  test.each(["EBUSY", "EPERM", "ENOTEMPTY"])("#given %s outlasts the inner retry budget #when the root is released #then the real composition removes it", async (code) => {
    const root = await mkdtemp(join(tmpdir(), "omo-teardown-composition-"))
    await writeFile(join(root, "fixture.txt"), "fixture")
    let calls = 0
    let now = 0
    const delays: number[] = []
    try {
      await removeWhenReleased(root, {
        rm: async (path, options) => {
          calls++
          expect(path).toBe(root)
          if (calls <= 3) throw errno(code)
          await rm(path, options)
        },
        sleep: async (ms) => { delays.push(ms); now += ms },
        now: () => now,
      })
      expect(calls).toBe(4)
      expect(delays).toEqual([50, 50, 50])
      expect(existsSync(root)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test.each(["EBUSY", "EPERM", "ENOTEMPTY"])("#given %s never releases #when the 30-second deadline passes #then the original cause is surfaced with bounded retries", async (code) => {
    const cause = errno(code)
    let now = 0
    let calls = 0
    const failure = await removeWhenReleased("locked-root", {
      rm: async () => { calls++; throw cause },
      sleep: async (ms) => { now += ms },
      now: () => now,
    }).catch((error: unknown) => error)
    expect(now).toBeGreaterThanOrEqual(30_000)
    expect(now).toBeLessThan(30_150)
    expect(calls).toBe(603)
    expect(failure).toMatchObject({ code })
    expect((failure as Error).cause).toBe(cause)
  })

  test.each(["EFAULT", "EACCES", "EIO"])("#given %s #when removal fails #then the release wait does not broaden its retry policy", async (code) => {
    const cause = errno(code)
    let now = 0
    let calls = 0
    const failure = await removeWhenReleased("unused", {
      rm: async () => { calls++; throw cause },
      sleep: async (ms) => { now += ms },
      now: () => now,
    }).catch((error: unknown) => error)
    expect(calls).toBe(code === "EFAULT" ? 3 : 1)
    expect(now).toBe(code === "EFAULT" ? 100 : 0)
    if (code === "EFAULT") expect((failure as Error).cause).toBe(cause)
    else expect(failure).toBe(cause)
  })
})
