import { execFileSync } from "node:child_process"
import { closeSync, constants, openSync } from "node:fs"
import { lstat } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { item, publish } from "./received-keys.test-support"

const posix = process.platform === "win32" ? test.skip : test

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

function releaseBlockedReader(fifo: string): void {
  try {
    closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK))
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENXIO")) throw error
  }
}

posix("a FIFO refused at landing stays unread on the next cycle's capture, which completes", async () => {
  const server = new FakeSyncServer()
  const b = await makeDevice(server, "b")
  devices.push(b)
  await b.engine.runCycle()
  const fifo = join(b.repo.root, "pipe.md")
  execFileSync("mkfifo", [fifo])
  await publish(server, item("pipe.md", "from a peer"), item("ok.md", "ok"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })

  // The refused key stays in the item store, so cycle 2's capture visits it although the walk did
  // not list it. Reading the FIFO there blocks until a writer opens it; the bounded race turns that
  // hang into a failure, and the writer opened afterwards lets the stuck read finish.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<{ kind: "timed-out" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timed-out" }), 5_000)
  })
  try {
    const settled = await Promise.race([b.engine.runCycle().then(() => ({ kind: "completed" as const })), timedOut])
    expect(settled).toEqual({ kind: "completed" })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    releaseBlockedReader(fifo)
  }

  expect((await lstat(fifo)).isFIFO()).toBe(true)
  expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
  await publish(server, item("after.md", "after"))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
  expect(await b.read("after.md")).toBe("after\n")
}, GIT_TEST_TIMEOUT)
