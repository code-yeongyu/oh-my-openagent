import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync } from "node:fs"
import { join } from "node:path"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"
import type { FreezeOutcome } from "./ports"

// #12506 (review of #12828): a `pending/` the outbox cannot list must surface through the engine's
// status, and must not hide a service freeze. Mode 0o300 keeps writes working, so only the sweep's
// listing fails: root reads it anyway, and Windows has no POSIX mode bits to deny it with.
const canDenyRead = process.platform !== "win32" && process.getuid?.() !== 0

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) {
    const pending = pendingDir(d)
    if (existsSync(pending)) chmodSync(pending, 0o700)
    await d.dispose()
  }
}, GIT_TEST_TIMEOUT)

const pendingDir = (device: Device): string => join(device.repo.gitDir, "omo-sync", "pending")

/** A device whose `pending/` stops being listable once the journal reaches `point`. */
async function unlistableAt(
  server: FakeSyncServer,
  point: string,
  options: Parameters<typeof makeDevice>[3] = {},
): Promise<Device> {
  let device: Device | null = null
  const a = await makeDevice(
    server,
    "a",
    (at) => {
      if (at === point && device !== null) chmodSync(pendingDir(device), 0o300)
    },
    options,
  )
  device = a
  devices.push(a)
  return a
}

test.skipIf(!canDenyRead)(
  "an outbox the push cannot clean fails the cycle, and the status shows it",
  async () => {
    const server = new FakeSyncServer()
    const a = await unlistableAt(server, "appended")
    await a.write("one.md", "one\n")
    await expect(a.engine.runCycle()).rejects.toMatchObject({ code: "EACCES" })
    expect(server.entries).toHaveLength(1)
    expect(await a.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "no_write_access", cause: { code: "EACCES", stage: "push" } } })
  },
  GIT_TEST_TIMEOUT,
)

test.skipIf(!canDenyRead)(
  "while pushes are frozen, an outbox the push cannot clean is logged and the freeze is still shown",
  async () => {
    const server = new FakeSyncServer()
    const logged: string[] = []
    const a = await unlistableAt(server, "sealed", {
      log: (line) => logged.push(line),
      freeze: { settle: async () => ({ kind: "frozen", reason: "unverified" }) },
    })
    await a.write("one.md", "one\n")
    server.frozen = true
    expect(await a.engine.runCycle()).toMatchObject({ pushed: false })
    expect(await a.engine.status()).toMatchObject({ kind: "frozen", reason: "unverified" })
    expect(logged.filter((line) => line.includes("cannot clean the outbox"))).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)

test.skipIf(!canDenyRead)(
  "a device frozen at startup with nothing to push and an outbox it cannot clean still shows the freeze",
  async () => {
    const server = new FakeSyncServer()
    const logged: string[] = []
    let outcome: FreezeOutcome = { kind: "clear" }
    const a = await makeDevice(server, "a", undefined, {
      log: (line) => logged.push(line),
      freeze: { settle: async () => outcome },
    })
    devices.push(a)
    await a.write("one.md", "one\n")
    expect(await a.engine.runCycle()).toMatchObject({ pushed: true })
    chmodSync(pendingDir(a), 0o300)
    outcome = { kind: "frozen", reason: "unverified" }
    server.frozen = true
    await a.restart()
    expect(await a.engine.runCycle()).toMatchObject({ pushed: false })
    expect(await a.engine.status()).toMatchObject({ kind: "frozen", reason: "unverified" })
    expect(logged.filter((line) => line.includes("cannot clean the outbox"))).toHaveLength(1)
  },
  GIT_TEST_TIMEOUT,
)
