import { afterEach, expect, test } from "bun:test"

import { splitBatches } from "./batches"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { staleBackoffMs } from "./push"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const item = (key: string, bytes: number) => ({ key, ops: "A".repeat(Math.ceil((bytes * 4) / 3)) })

test("pending ops split between items so no batch exceeds the plaintext bound, in capture order", () => {
  const limit = 1_000
  const items = [item("a", 400), item("b", 400), item("c", 400), item("d", 900)]
  const batches = splitBatches(items, limit)
  expect(batches.map((b) => b.map((i) => i.key))).toEqual([["a", "b"], ["c"], ["d"]])
  expect(batches.flat()).toEqual(items)
})

test("one item alone over the bound is refused, never sent oversized", () => {
  expect(() => splitBatches([item("huge", 2_000)], 1_000)).toThrow(/exceeds/)
})

test("a backlog larger than one batch is pushed as consecutive batches the other device applies in order", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { batchBytes: 64 })
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  for (const n of [1, 2, 3]) await a.write(`n${n}.md`, `line ${n}\n`)
  await a.engine.runCycle()
  expect(server.entries.length).toBeGreaterThan(1)
  await b.engine.runCycle()
  expect([await b.read("n1.md"), await b.read("n2.md"), await b.read("n3.md")]).toEqual(["line 1\n", "line 2\n", "line 3\n"])
}, GIT_TEST_TIMEOUT)

test("stale-base retries back off with jitter inside a doubling window", () => {
  const draws = [0, 0.5, 0.999]
  for (const attempt of [0, 1, 2, 3]) {
    const window = Math.min(250 * 2 ** attempt, 8_000)
    for (const draw of draws) {
      const ms = staleBackoffMs(attempt, () => draw)
      expect(ms).toBeGreaterThanOrEqual(window / 2)
      expect(ms).toBeLessThan(window)
    }
  }
  expect(staleBackoffMs(20, () => 0.999)).toBeLessThan(8_000)
})

test("a stale base receives the racing batch first, then retries after a jittered wait on the engine clock", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  await b.write("b.md", "b\n")
  server.beforeNextAppend = async () => {
    await a.write("a.md", "a\n")
    await a.engine.runCycle()
  }
  const before = b.clock.now()
  const cycle = b.engine.runCycle()
  await b.clock.untilPending()
  b.clock.advance(8_000)
  expect(await cycle).toMatchObject({ pushed: true, applied: 1 })
  expect(b.clock.now() - before).toBeGreaterThanOrEqual(125)
  expect(server.appends.map((x) => x.ok)).toEqual([true, false, true])
  expect(server.entries.map((e) => e.seq)).toEqual([1, 2])
  expect(await b.read("a.md")).toBe("a\n")
  await a.engine.runCycle()
  expect(await a.read("b.md")).toBe("b\n")
}, GIT_TEST_TIMEOUT)
