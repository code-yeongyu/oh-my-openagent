import { afterEach, expect, test } from "bun:test"

import { CrashInjected } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

test("a copied memory repo never pushes the origin device's journaled batch; the copy starts its own journal", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  devices.push(a)
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  await a.restart((at) => {
    if (at === "sealed") throw new CrashInjected(at)
  })
  await a.write("y.md", "y\n")
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  const sealed = (await a.engine.journal.pending()).outgoing?.batchId
  if (sealed === undefined) throw new Error("a sealed no batch")
  const copy = await makeDevice(server, "copy", undefined, { memoryFrom: a.repo.root })
  devices.push(copy)
  await copy.engine.runCycle()
  // The copy may adopt its working tree insert-only under its own peer (sync-design §3), but
  // the origin's sealed batch id belongs to the origin alone.
  expect(server.entries.filter((e) => e.author === "device:copy").map((e) => e.batchId)).not.toContain(sealed)
  expect(server.entries.filter((e) => e.batchId === sealed)).toEqual([])
  expect((await copy.engine.state()).peer).toBe("copy")
  expect(await copy.retiredJournals()).toHaveLength(1)
  await a.restart()
  // The copy's adoption moved the head, so a's sealed batch is stale once: drive its backoff.
  const resumed = a.engine.runCycle()
  await a.clock.untilPending()
  a.clock.advance(8_000)
  await resumed
  // Stale once, the batch was resealed on the new base under a fresh id; its ops land from a.
  expect(server.entries.filter((e) => e.batchId === sealed)).toEqual([])
  expect(server.entries.filter((e) => e.author === "device:a")).toHaveLength(2)
  await copy.engine.runCycle()
  expect(await copy.read("y.md")).toBe("y\n")
  expect(await copy.read("x.md")).toBe("x\n")
}, GIT_TEST_TIMEOUT)

test("the same device reopening its own journal keeps it", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  devices.push(a)
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  await a.restart()
  await a.engine.runCycle()
  expect(await a.engine.state()).toMatchObject({ peer: "a", applied: 1 })
  expect(await a.retiredJournals()).toEqual([])
}, GIT_TEST_TIMEOUT)
