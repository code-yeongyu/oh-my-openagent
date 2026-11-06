import { describe, expect, test } from "bun:test"
import { mirrorChannel } from "./mirror-channel"

describe("mirrorChannel", () => {
  test("a dry run writes and reads the scratch pointer without changing the live channel", async () => {
    // given
    const scratch = new Map<string, string>()
    const scratchWrites: string[] = []
    const liveWrites: string[] = []
    const store = {
      async readText(key: string) { return scratch.get(key) ?? null },
      async write(key: string, body: string) { scratchWrites.push(body); scratch.set(key, body) },
    }
    const live = {
      async readText() { return "5.1.47\n" },
      async write(key: string) { liveWrites.push(key) },
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
      async readText() { return "5.1.49\n" },
      async write(key: string) { writes.push(key) },
    }
    // when
    const pointer = await mirrorChannel(store, store, "channels/latest", "5.1.48", false, false, () => {})
    // then
    expect(pointer).toBe("5.1.49")
    expect(writes).toEqual([])
  })

  test.each([{ force: false }, { force: true }])("production force=$force writes and verifies the live pointer", async ({ force }) => {
    // given
    let pointer = force ? "5.1.49\n" : "5.1.47\n"
    const store = {
      async readText() { return pointer },
      async write(_key: string, body: string) { pointer = body },
    }
    // when
    const result = await mirrorChannel(store, store, "channels/latest", "5.1.48", false, force, () => {})
    // then
    expect(result).toBe("5.1.48")
    expect(pointer).toBe("5.1.48\n")
  })

  test.each([{ force: false }, { force: true }])("newer concurrent read-back force=$force", async ({ force }) => {
    let reads = 0
    const logs: string[] = []
    const store = {
      async readText() { return ++reads === 1 ? "5.1.47\n" : "5.1.49\n" },
      async write() {},
    }
    const result = mirrorChannel(store, store, "channels/latest", "5.1.48", false, force, (line) => logs.push(line))
    if (force) await expect(result).rejects.toThrow("pointer read-back")
    else {
      expect(await result).toBe("5.1.49")
      expect(logs.some((line) => line.includes("5.1.49") && line.includes("newer"))).toBe(true)
    }
  })

  test("a dry backfill probes overwrite while reporting the production decision", async () => {
    const writes: string[] = []
    const logs: string[] = []
    const scratch = {
      async readText() { return writes.at(-1) ?? null },
      async write(_key: string, body: string) { writes.push(body) },
    }
    const live = {
      async readText() { return "5.1.49\n" },
      async write() { throw new Error("dry run touched production") },
    }
    await mirrorChannel(scratch, live, "channels/latest", "5.1.48", true, false, (line) => logs.push(line))
    expect(writes).toEqual(["5.1.49\n", "5.1.48\n"])
    expect(logs.some((line) => line.includes("shouldMoveChannel=false"))).toBe(true)
  })

  test("a mismatched scratch read-back fails the dry run", async () => {
    // given
    const store = {
      async readText() { return null },
      async write() {},
    }
    // when
    const result = mirrorChannel(store, store, "channels/latest", "5.1.48", true, false, () => {})
    // then
    await expect(result).rejects.toThrow("pointer read-back")
  })
})
