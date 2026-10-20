import { afterEach, expect, test } from "bun:test"

import { CrashInjected, INBOUND_POINTS, OUTBOUND_POINTS } from "./engine"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const crashAt = (point: string) => (at: string) => {
  if (at === point) throw new CrashInjected(point)
}

async function world() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  devices.push(a)
  return { server, a }
}

test.each([...INBOUND_POINTS])("a receive crash at %s resumes with every line, one commit, no temp file", async (point) => {
  const { server, a } = await world()
  await a.write("one.md", "one\n")
  await a.engine.runCycle()
  await a.write("two.md", "two\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt(point))
  devices.push(b)
  await b.write("local.md", "kept\n")
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.restart()
  await b.engine.runCycle()
  expect([await b.read("one.md"), await b.read("two.md"), await b.read("local.md")]).toEqual(["one\n", "two\n", "kept\n"])
  expect(await b.syncCommits()).toEqual(["1-2"])
  expect(await b.workingTempFiles()).toEqual([])
  expect((await b.engine.state()).applied).toBeGreaterThanOrEqual(2)
  await a.engine.runCycle()
  expect(await a.read("local.md")).toBe("kept\n")
}, GIT_TEST_TIMEOUT)

test.each([...OUTBOUND_POINTS])("a push crash at %s resumes with the batch appended exactly once", async (point) => {
  const { server, a } = await world()
  await a.restart(crashAt(point))
  await a.write("mine.md", "edit\n")
  await expect(a.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await a.restart()
  await a.engine.runCycle()
  expect(server.entries).toHaveLength(1)
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  expect(await b.read("mine.md")).toBe("edit\n")
  expect((await a.engine.state()).applied).toBe(1)
  expect(await a.engine.runCycle()).toMatchObject({ pushed: false, applied: 0 })
}, GIT_TEST_TIMEOUT)

test("a crash after the git commit but before `committed` is reconciled from HEAD, not re-committed", async () => {
  const { server, a } = await world()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt("git-commit"))
  devices.push(b)
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect((await b.engine.state()).cycle?.stage).toBe("rendered")
  await b.restart()
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect(await b.engine.state()).toMatchObject({ applied: 1, cycle: null })
}, GIT_TEST_TIMEOUT)

test("an agent commit landing between `rendered` and `committed` does not fool reconciliation", async () => {
  const { server, a } = await world()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  const b = await makeDevice(server, "b", crashAt("rendered"))
  devices.push(b)
  await expect(b.engine.runCycle()).rejects.toBeInstanceOf(CrashInjected)
  await b.write("agent.md", "agent\n")
  await b.repo.commit(["agent.md"], "agent: a memory write")
  await b.restart()
  await b.engine.runCycle()
  expect(await b.syncCommits()).toEqual(["1-1"])
  expect([await b.read("x.md"), await b.read("agent.md")]).toEqual(["x\n", "agent\n"])
}, GIT_TEST_TIMEOUT)
