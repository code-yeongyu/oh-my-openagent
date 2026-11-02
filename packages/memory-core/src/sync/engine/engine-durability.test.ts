import { afterEach, expect, spyOn, test } from "bun:test"
import { dirname } from "node:path"

import * as resilient from "../../fs/resilient"
import * as fsync from "../../journal/fsync"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #10588 item 1: strict POSIX does not promise that one later directory fsync orders an earlier
// unlink before a later rename, so the unlink of a staged path must be durable on its own before
// the render step stages anything or appends its record.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

test("the unlink of a staged path is fsynced before the render step writes anything", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  await a.write("x.md", "one\n")
  await a.engine.runCycle()

  const events: string[] = []
  const realRm = resilient.rm
  const realWriteFile = resilient.writeFile
  const realRename = resilient.rename
  const realSyncDir = fsync.syncJournalDirectory
  const spies = [
    spyOn(resilient, "rm").mockImplementation((path, options) => {
      events.push(`rm ${String(path)}`)
      return realRm(path, options)
    }),
    spyOn(resilient, "writeFile").mockImplementation((file, data, options) => {
      events.push(`write ${String(file)}`)
      return realWriteFile(file, data, options)
    }),
    spyOn(resilient, "rename").mockImplementation((from, to) => {
      events.push(`rename ${String(from)}`)
      return realRename(from, to)
    }),
    spyOn(fsync, "syncJournalDirectory").mockImplementation((dir) => {
      events.push(`syncdir ${dir}`)
      return realSyncDir(dir)
    }),
  ]
  try {
    await b.engine.runCycle()
  } finally {
    for (const spy of spies) spy.mockRestore()
  }

  expect(await b.read("x.md")).toBe("one\n")
  const unlinks = events.flatMap((e, i) => (e.startsWith("rm ") && e.endsWith(".staged") ? [i] : []))
  expect(unlinks.length).toBeGreaterThan(0)
  for (const i of unlinks) {
    const staged = events[i]?.slice("rm ".length) ?? ""
    expect(events[i + 1]).toBe(`syncdir ${dirname(staged)}`)
  }
}, GIT_TEST_TIMEOUT)
