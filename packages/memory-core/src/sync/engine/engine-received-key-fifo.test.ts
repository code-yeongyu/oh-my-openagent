import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import { item, publish } from "./received-keys.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

// #12575 (ported from #12678): a received key refused at landing because its path is a FIFO stays in the item store,
// so the next cycle's capture visits it although the walk did not list it. Reading the FIFO there blocked the cycle
// until a writer opened it.
test.skipIf(process.platform === "win32")(
  "a FIFO refused at landing stays unread on the next cycle's capture, which completes, and later publishes apply",
  async () => {
    // given
    const server = new FakeSyncServer()
    const b = await makeDevice(server, "b")
    devices.push(b)
    await b.engine.runCycle()
    const fifo = join(b.repo.root, "pipe.md")
    expect(await Bun.spawn(["mkfifo", fifo]).exited).toBe(0)
    await publish(server, item("pipe.md", "from a peer"), item("ok.md", "ok"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1, rejectedItems: 1 })
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<"timed-out">((resolve) => {
      timeoutId = setTimeout(() => resolve("timed-out"), 10_000)
    })

    // when
    try {
      const settled = await Promise.race([b.engine.runCycle().then(() => "settled" as const), timeout])

      // then
      expect(settled).toBe("settled")
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      // A cycle the pre-fix code left blocked on the FIFO is released by opening its write end. Non-blocking, so with no
      // reader waiting the open fails with ENXIO instead of blocking the test.
      await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).then(
        (handle) => handle.close(),
        () => undefined,
      )
    }
    expect((await lstat(fifo)).isFIFO()).toBe(true)
    expect(await b.engine.state()).toMatchObject({ cycle: null, paused: null })
    await publish(server, item("after.md", "after"))
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
    expect(await b.read("after.md")).toBe("after\n")
  },
  GIT_TEST_TIMEOUT,
)
