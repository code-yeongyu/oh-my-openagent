import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { besideRoot, item, publish } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function receiver(server: FakeSyncServer): Promise<Device> {
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  return b
}

test("received keys that leave the memory root write nothing outside it and never wedge the cycle", async () => {
  const server = new FakeSyncServer()
  const b = await receiver(server)
  const beside = await besideRoot(b)
  const outside = join(dirname(b.repo.root), "abs.md")
  const keys = ["../escape.md", "sub/../../escape.md", outside, "C:\\escape.md", "c:escape.md", "//srv/share/escape.md", "\\\\srv\\share\\escape.md", "./escape.md", "sub//escape.md", "sub/"]
  for (const [i, key] of keys.entries()) {
    const seq = await publish(server, item(key, "escaped"), item(`ok-${i}.md`, `ok ${i}`))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    expect(await b.engine.state()).toMatchObject({ applied: seq, cycle: null, paused: null })
  }
  expect(await besideRoot(b)).toEqual(beside)
  expect(await b.workingFiles()).toEqual([".gitkeep", ...keys.map((_, i) => `ok-${i}.md`)].sort())
  await publish(server, item("after.md", "after"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 0 })
  expect(await b.read("after.md")).toBe("after\n")
}, GIT_TEST_TIMEOUT)

test("a received deletion of a key outside the memory root leaves that file untouched", async () => {
  const server = new FakeSyncServer()
  const b = await receiver(server)
  const victim = join(dirname(b.repo.root), "victim.md")
  await writeFile(victim, "precious\n")
  await publish(server, item("../victim.md"), item("ok.md", "ok"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
  expect(await readFile(victim, "utf8")).toBe("precious\n")
  expect(await b.read("ok.md")).toBe("ok\n")
  expect(await b.engine.state()).toMatchObject({ cycle: null })
}, GIT_TEST_TIMEOUT)

test("a received key under a directory symlinked out of the memory root is dropped before anything is written", async () => {
  const server = new FakeSyncServer()
  const b = await receiver(server)
  const outside = join(dirname(b.repo.root), "outside")
  await mkdir(outside)
  await symlink(outside, join(b.repo.root, "linked"), "dir")
  await publish(server, item("linked/x.md", "through the link"), item("linked/deeper/y.md", "deeper"), item("ok.md", "ok"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 2 })
  expect(await readdir(outside)).toEqual([])
  expect(await b.read("ok.md")).toBe("ok\n")
  expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  expect(await b.renderJournals()).toEqual([])
}, GIT_TEST_TIMEOUT)
