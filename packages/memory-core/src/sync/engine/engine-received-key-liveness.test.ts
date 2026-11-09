import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { item, publish } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function receiver(server: FakeSyncServer, log?: (line: string) => void): Promise<Device> {
  const b = await makeDevice(server, "b", undefined, log === undefined ? {} : { log })
  devices.push(b)
  await b.engine.runCycle()
  return b
}

/** Valid by shape (every segment within 255 bytes, the key within 4096) yet longer than any path the OS opens. */
const LONG_KEY = [...Array.from({ length: 15 }, (_, i) => `${String(i).padStart(2, "0")}${"a".repeat(253)}`), `${"z".repeat(252)}.md`].join("/")

test("received keys that cannot name a portable file are dropped and the next batch still applies", async () => {
  const server = new FakeSyncServer()
  const lines: string[] = []
  const b = await receiver(server, (line) => lines.push(line))
  const keys = ["", "bad\u0000name.md", "con.md", "Aux.txt", "lpt9", "trailing. /x.md", "space /x.md", "q?.md", "a:b.md", "pipe|.md", "git.cmd", "GIT.EXE", "COM\u00b3.md", "conout$", "x\u202e.md", "cafe\u0301.md"]
  for (const key of keys) {
    await publish(server, item(key, "bad"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  }
  expect(await b.workingFiles()).toEqual([".gitkeep"])
  expect(await b.engine.state()).toMatchObject({ rejectedItems: keys.length })
  await publish(server, item("n1.md", "one"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 0 })
  expect(await b.read("n1.md")).toBe("one\n")
  const receipts = lines.filter((line) => line.startsWith("sync.item.rejected"))
  expect(receipts).toHaveLength(keys.length)
  for (const key of keys.filter((k) => k.length > 3)) for (const receipt of receipts) expect(receipt.includes(key)).toBe(false)
}, GIT_TEST_TIMEOUT)

test("a valid key the receiver's file system cannot hold is dropped before any render and never wedges the device", async () => {
  const server = new FakeSyncServer()
  const b = await receiver(server)
  await b.write("people/ann/card.md", "ann\n")
  await b.engine.runCycle()
  await publish(server, item("people", "a file over a directory"), item("people/ann/card.md/x", "under a file"), item(LONG_KEY, "too long to open"), item("good.md", "good"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 3 })
  expect(await b.read("good.md")).toBe("good\n")
  expect(await b.read("people/ann/card.md")).toBe("ann\n")
  expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  expect(await b.renderJournals()).toEqual([])
  await publish(server, item("n2.md", "two"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
  expect(await b.read("n2.md")).toBe("two\n")
  expect(await b.workingFiles()).toEqual([".gitkeep", "good.md", "n2.md", "people/ann/card.md"])
}, GIT_TEST_TIMEOUT)

test("a key a sibling in the same batch turns into a directory is dropped instead of failing the render", async () => {
  const server = new FakeSyncServer()
  const b = await receiver(server)
  await publish(server, item("notes", "a file"), item("notes/inner.md", "inner"), item("ok.md", "ok"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
  expect(await b.read("notes")).toBe("a file\n")
  expect(await b.read("ok.md")).toBe("ok\n")
  expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  await publish(server, item("n3.md", "three"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
  expect(await b.read("n3.md")).toBe("three\n")
}, GIT_TEST_TIMEOUT)
