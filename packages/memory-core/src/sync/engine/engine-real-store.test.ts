import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const note = (body: string) => `---\ndescription: shared note\n---\n${body}`

test("two engines on the production Loro item store converge, keeping both sides' edits to one note", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a", undefined, { realStore: true })
  const b = await makeDevice(server, "b", undefined, { realStore: true })
  devices.push(a, b)
  await a.write("note.md", note("first line\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  expect(await b.read("note.md")).toBe(note("first line\n"))
  await a.write("note.md", note("first line\nfrom a\n"))
  await b.write("note.md", note("from b\nfirst line\n"))
  await a.engine.runCycle()
  await b.engine.runCycle()
  await a.engine.runCycle()
  const [onA, onB] = [await a.read("note.md"), await b.read("note.md")]
  expect(onA).toBe(onB)
  for (const piece of ["first line", "from a", "from b"]) expect(onA).toContain(piece)
  expect(await b.syncCommits()).toHaveLength(2)
}, GIT_TEST_TIMEOUT)
