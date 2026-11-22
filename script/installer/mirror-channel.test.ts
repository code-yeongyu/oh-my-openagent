import { describe, expect, test } from "bun:test"
import { mirrorChannel } from "./mirror-channel"
import { withRetry } from "./mirror-retry"

describe("mirrorChannel", () => {
  test("a dry run writes and reads the scratch pointer without changing the live channel", async () => {
    // given
    const scratch = new Map<string, string>()
    const scratchWrites: string[] = []
    const liveWrites: string[] = []
    const store = {
      async readText(key: string) {
        return scratch.get(key) ?? null
      },
      async write(key: string, body: string) {
        scratchWrites.push(body)
        scratch.set(key, body)
      },
      async writeOnce() {
        throw new Error("a dry run never writes once")
      },
    }
    const live = {
      async readText() {
        return "5.1.47\n"
      },
      async write(key: string) {
        liveWrites.push(key)
      },
      async writeOnce(key: string) {
        liveWrites.push(key)
      },
    }
    // when
    const pointer = await mirrorChannel(store, live, "channels/latest", "5.1.48", true, false, () => {})
    // then
    expect(scratch.get("channels/latest")).toBe("5.1.48\n")
    expect(pointer).toBe("5.1.48")
    expect(liveWrites).toEqual([])
    expect(scratchWrites).toEqual(["5.1.47\n", "5.1.48\n"])
  })

  test("a production backfill preserves a newer live channel", async () => {
    // given
    const writes: string[] = []
    const store = {
      async readText() {
        return "5.1.49\n"
      },
      async write(key: string) {
        writes.push(key)
      },
      async writeOnce(key: string) {
        writes.push(key)
      },
    }
    // when
    const pointer = await mirrorChannel(store, store, "channels/latest", "5.1.48", false, false, () => {})
    // then
    expect(pointer).toBe("5.1.49")
    expect(writes).toEqual([])
  })

  test.each([{ force: false }, { force: true }])(
    "production force=$force writes and verifies the live pointer",
    async ({ force }) => {
      // given
      let pointer = force ? "5.1.49\n" : "5.1.47\n"
      const store = {
        async readText() {
          return pointer
        },
        async write(_key: string, body: string) {
          pointer = body
        },
        async writeOnce(_key: string, body: string) {
          pointer = body
        },
      }
      // when
      const result = await mirrorChannel(store, store, "channels/latest", "5.1.48", false, force, () => {})
      // then
      expect(result).toBe("5.1.48")
      expect(pointer).toBe("5.1.48\n")
    },
  )

  test.each([{ force: false }, { force: true }])(
    "a newer pointer that lands after the write is read back force=$force",
    async ({ force }) => {
      // given a pointer still at 5.1.47 when this attempt checks it, and a 5.1.49 release landing right after the PUT
      let pointer = "5.1.47\n"
      const writes: string[] = []
      const logs: string[] = []
      const store = {
        async readText() {
          return pointer
        },
        async write() {},
        async writeOnce(_key: string, body: string) {
          writes.push(body)
          pointer = "5.1.49\n"
        },
      }
      // when
      const result = mirrorChannel(store, store, "channels/latest", "5.1.48", false, force, (line) => logs.push(line))
      // then the write happened, and only a non-forced run accepts the newer read-back
      if (force) await expect(result).rejects.toThrow("pointer read-back")
      else {
        expect(await result).toBe("5.1.49")
        expect(logs).toContain("channels/latest: accepted newer pointer read-back 5.1.49 after writing 5.1.48")
      }
      expect(writes).toEqual(["5.1.48\n"])
    },
  )

  test("a newer pointer that lands before the write is left alone", async () => {
    // given a pointer at 5.1.47 at the first read and at 5.1.49 when the attempt re-reads it
    let reads = 0
    const writes: string[] = []
    const logs: string[] = []
    const store = {
      async readText() {
        return ++reads === 1 ? "5.1.47\n" : "5.1.49\n"
      },
      async write() {},
      async writeOnce(_key: string, body: string) {
        writes.push(body)
      },
    }
    // when
    const result = await mirrorChannel(store, store, "channels/latest", "5.1.48", false, false, (line) =>
      logs.push(line),
    )
    // then nothing is written and the newer pointer is the answer
    expect(writes).toEqual([])
    expect(result).toBe("5.1.49")
    expect(logs).toContain("channels/latest: 5.1.49 is newer than 5.1.48 before this attempt; not overwriting it")
  })

  test("a dry backfill probes overwrite while reporting the production decision", async () => {
    const writes: string[] = []
    const logs: string[] = []
    const scratch = {
      async readText() {
        return writes.at(-1) ?? null
      },
      async write(_key: string, body: string) {
        writes.push(body)
      },
      async writeOnce() {
        throw new Error("a dry run never writes once")
      },
    }
    const live = {
      async readText() {
        return "5.1.49\n"
      },
      async write() {
        throw new Error("dry run touched production")
      },
      async writeOnce() {
        throw new Error("dry run touched production")
      },
    }
    await mirrorChannel(scratch, live, "channels/latest", "5.1.48", true, false, (line) => logs.push(line))
    expect(writes).toEqual(["5.1.49\n", "5.1.48\n"])
    expect(logs.some((line) => line.includes("shouldMoveChannel=false"))).toBe(true)
  })

  test("a mismatched scratch read-back fails the dry run", async () => {
    // given
    const store = {
      async readText() {
        return null
      },
      async write() {},
      async writeOnce() {},
    }
    // when
    const result = mirrorChannel(store, store, "channels/latest", "5.1.48", true, false, () => {})
    // then
    await expect(result).rejects.toThrow("pointer read-back")
  })

  // #11341: R2 can commit a PUT and still answer an error; a newer release may move the pointer before the retry.
  test("a retried pointer write never overwrites a newer pointer that landed after the failed attempt", async () => {
    // given a live pointer at 5.1.47 whose first PUT of 5.1.48 commits but reports a 502,
    // and a concurrent 5.1.50 release that moves the pointer before the retry
    let pointer = "5.1.47\n"
    let attempts = 0
    const sleeps: number[] = []
    const noWait = async (ms: number) => {
      sleeps.push(ms)
    }
    const writeOnce = async (_key: string, body: string) => {
      attempts++
      pointer = body
      if (attempts === 1) {
        pointer = "5.1.50\n"
        throw new Error("HTTP 502 Bad Gateway")
      }
    }
    const live = {
      async readText() {
        return pointer
      },
      writeOnce,
      // The production store's write is the same single attempt wrapped in the shared retry.
      async write(key: string, body: string) {
        await withRetry(`write ${key}`, () => writeOnce(key, body), noWait)
      },
    }
    // when
    const result = await mirrorChannel(live, live, "channels/latest", "5.1.48", false, false, () => {}, noWait)
    // then the newer pointer survives and only the first attempt wrote
    expect(pointer).toBe("5.1.50\n")
    expect(result).toBe("5.1.50")
    expect(attempts).toBe(1)
    expect(sleeps).toEqual([5_000])
  })
})
