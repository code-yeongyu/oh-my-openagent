import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function pair() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  return { server, a, b }
}

test("each direction converges in one cycle of the receiving device", async () => {
  const { a, b } = await pair()
  await a.write("notes/a.md", "from a\n")
  await a.engine.runCycle()
  await b.write("notes/b.md", "from b\n")
  const bReport = await b.engine.runCycle()
  expect(bReport).toMatchObject({ applied: 1, pushed: true })
  expect(await b.read("notes/a.md")).toBe("from a\n")
  await a.engine.runCycle()
  expect(await a.read("notes/b.md")).toBe("from b\n")
  expect(await a.read("notes/a.md")).toBe("from a\n")
}, GIT_TEST_TIMEOUT)

test("concurrent edits to one file on two devices both survive", async () => {
  const { a, b } = await pair()
  await a.write("shared.md", "base\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.write("shared.md", "a line\nbase\n")
  await b.write("shared.md", "b line\nbase\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.engine.runCycle()
  const expected = "a line\nb line\nbase\n"
  expect([await a.read("shared.md"), await b.read("shared.md")]).toEqual([expected, expected])
}, GIT_TEST_TIMEOUT)

test("a sync commit names its seq range and is authored OmO Sync; nothing to apply commits nothing", async () => {
  const { a, b } = await pair()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect(await a.syncCommits()).toEqual([])
}, GIT_TEST_TIMEOUT)

test("a replayed or duplicated delivery is a no-op", async () => {
  const { server, a, b } = await pair()
  await a.write("x.md", "one\n")
  await a.engine.runCycle()
  server.duplicateNextPage = true
  const first = await b.engine.runCycle()
  expect(first.applied).toBe(1)
  await b.restart()
  const state = await b.engine.state()
  expect(state.applied).toBe(1)
  expect(await b.engine.runCycle()).toMatchObject({ applied: 0, refused: 0 })
  expect(await b.read("x.md")).toBe("one\n")
  expect(await b.syncCommits()).toEqual(["1-1"])
}, GIT_TEST_TIMEOUT)

test("a device's own pushed batch is not applied back to it", async () => {
  const { a } = await pair()
  await a.write("own.md", "mine\n")
  expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
  expect(await a.engine.runCycle()).toMatchObject({ applied: 0, pushed: false })
  expect((await a.engine.state()).applied).toBe(1)
}, GIT_TEST_TIMEOUT)
